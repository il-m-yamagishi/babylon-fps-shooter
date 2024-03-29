/**
 * @author Masaru Yamagishi <yamagishi.iloop@gmail.com>
 * @license Apache-2.0
 */

// import { RayHelper } from '@babylonjs/core/Debug/rayHelper'
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { CapsuleBuilder } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { Scene, SceneOptions } from '@babylonjs/core/scene';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Sound } from '@babylonjs/core/Audio/sound';
import { SSAORenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssaoRenderingPipeline';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { aroundWall } from './MainScene/Stage/aroundWall';
import { ground } from './MainScene/Stage/ground';
import { houses } from './MainScene/Stage/houses';
import { mainLight } from './MainScene/Stage/mainLight';
import { obstacle } from './MainScene/Stage/obstacle';
import { skybox } from './MainScene/Stage/skybox';
import { ShooterCameraDashInput } from './MainScene/ShooterCameraDashInput';
import { SceneInterface } from './SceneInterface';
import { ContextHolder } from './ContextHolder';

// side-effects
import '@babylonjs/core/Audio/audioSceneComponent';
import '@babylonjs/core/Collisions/collisionCoordinator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Loading/Plugins/babylonFileLoader';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';

// @see https://vitejs.dev/guide/assets.html#importing-asset-as-url
// @see https://www.videvo.net/sound-effect/gun-shot-single-shot-in-pe1097906/246309/
import gunfireSoundURL from './assets/gunfire.mp3?url';

/**
 * Main in-game scene
 */
export class MainScene implements SceneInterface {
    private readonly engine: Engine;
    private readonly scene: Scene;
    private readonly camera: Camera;
    private readonly mainLight: DirectionalLight;
    private readonly shadowGenerator: ShadowGenerator;
    private gunfireSound?: Sound;

    /**
     * Constructor
     */
    constructor(contextHolder: ContextHolder, sceneOptions?: SceneOptions) {
        this.engine = contextHolder.engine;

        const canvas = this.engine.getRenderingCanvas();
        if (!canvas) {
            throw new Error('Unknown canvas element');
        }
        this.scene = new Scene(this.engine, sceneOptions);
        this.camera = setUpCamera(canvas, this.scene);
        this.mainLight = mainLight(this.scene);
        this.shadowGenerator = new CascadedShadowGenerator(2048, this.mainLight);
        setUpCrossHair();
        new SSAORenderingPipeline(`ssaoPipeline`, this.scene, 0.75, [this.camera]);
    }

    /**
     * Start main loop
     */
    public async start(): Promise<void> {
        skybox(this.scene);
        ground(this.scene);
        aroundWall(this.scene);
        obstacle(this.scene);
        this.gunfireSound = await new Promise((resolve: (value: Sound) => void) => {
            const sound: Sound = new Sound(`Gunfire`, gunfireSoundURL, this.scene, () => resolve(sound));
        });
        await houses(this.scene, this.shadowGenerator);
        await loadMobs(this.scene, this.shadowGenerator);
        this.scene.activeCamera = this.camera;
        document.addEventListener('click', this.onMouseClick);
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
    }

    public async dispose(): Promise<void> {
        this.scene.dispose();
    }

    public async render(): Promise<void> {
        this.scene.render();
    }

    /**
     * Execute when mouse has clicked inside game
     */
    private readonly onMouseClick = (evt: MouseEvent): void => {
        if (!this.engine.isPointerLock) {
            this.engine.enterPointerlock();
        }

        // button: 0 equals primary
        if (evt.button !== 0) {
            return;
        }

        const origin = this.camera.globalPosition.clone();
        const forward = this.camera.getDirection(Vector3.Forward());
        const ray = new Ray(origin, forward, 200);
        // const rayHelper = new RayHelper(ray);
        // rayHelper.show(this.scene);

        if (this.gunfireSound) {
            this.gunfireSound.play();
        }

        const hit = this.scene.pickWithRay(ray, (mesh) => {
            return mesh.name.match(/^Mob.+/) !== null;
        });
        if (hit && hit.pickedMesh) {
            hit.pickedMesh.dispose();
        }
    };
}

/**
 * Creates main camera
 *
 * @param canvas Target CanvasElement
 * @param scene Target Scene
 */
function setUpCamera(canvas: HTMLCanvasElement, scene: Scene): Camera {
    const initialPotision = new Vector3(Math.random() * 200 - 100, 2, Math.random() * 200 - 100);
    const camera = new FreeCamera(`MainCamera`, initialPotision, scene);
    camera.setTarget(Vector3.Zero());
    camera.inputs.add(new ShooterCameraDashInput(camera));
    camera.attachControl(canvas, true);
    camera.applyGravity = true;
    camera.ellipsoid = new Vector3(1.2, 1.2, 1.2);
    camera.checkCollisions = true;

    return camera;
}

/**
 * Creates center crosshair
 */
function setUpCrossHair(): AdvancedDynamicTexture {
    const tex = AdvancedDynamicTexture.CreateFullscreenUI('FullscreenUI');

    const xRect = new Rectangle('xRect');
    xRect.width = '20px';
    xRect.height = '2px';
    xRect.color = 'White';
    xRect.background = 'White';
    tex.addControl(xRect);

    const yRect = new Rectangle('yRect');
    yRect.width = '2px';
    yRect.height = '20px';
    yRect.color = 'White';
    yRect.background = 'White';
    tex.addControl(yRect);

    return tex;
}

/**
 * Generate mobs
 *
 * @param scene Target Scene
 * @param shadowGenerator Shadow Generator
 */
async function loadMobs(scene: Scene, shadowGenerator: ShadowGenerator): Promise<void> {
    const capsuleBase = CapsuleBuilder.CreateCapsule(
        `mobBase`,
        {
            height: 4,
            capSubdivisions: 6,
            radius: 1,
            subdivisions: 4,
            tessellation: 16,
        },
        scene
    );
    capsuleBase.position.y = 1;
    const material = new StandardMaterial(`MobMaterialBase`, scene);
    capsuleBase.material = material;

    for (let index = 0; index < 100; index++) {
        const capsule = capsuleBase.clone(`Mob${index}`, null);
        capsule.material = material.clone(`MobMaterial${index}`);
        (capsule.material as StandardMaterial).diffuseColor = new Color3(Math.random(), Math.random(), Math.random());
        shadowGenerator.addShadowCaster(capsule);
        capsule.position = new Vector3(Math.random() * 200 - 100, 2, Math.random() * 200 - 100);
        capsule.rotate(Vector3.Up(), Math.random() * Math.PI * 4);
        scene.onBeforeRenderObservable.add(() => {
            capsule.rotate(Vector3.Up(), Math.random() * 0.5 - 0.25);
            const delta = scene.getEngine().getDeltaTime() / 100;
            capsule.moveWithCollisions(capsule.forward.multiplyByFloats(delta, delta, delta));
        });
    }

    capsuleBase.isVisible = false;
}
