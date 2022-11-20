import * as THREE from "/build/three.module.js";
import Stats from "./jsm/libs/stats.module.js";
import { OrbitControls } from "./jsm/controls/OrbitControls.js";
import { FBXLoader } from "./jsm/loaders/FBXLoader.js";
import { TGALoader } from "./jsm/loaders/TGALoader.js";
import { VRButton } from "./jsm/webxr/VRButton.js";
import { BoxLineGeometry } from "./jsm/geometries/BoxLineGeometry.js";
import { XRControllerModelFactory } from "./jsm/webxr/XRControllerModelFactory.js"; //controller models
import { XRHandModelFactory } from "./jsm/webxr/XRHandModelFactory.js"; //hand models
import { OculusHandModel } from "./jsm/webxr/OculusHandModel.js";

import {
  World,
  System,
  Component,
  TagComponent,
  Types,
} from "./jsm/libs/ecsy.module.js";
//------------------Button System
class Object3D extends Component {}

Object3D.schema = {
  object: { type: Types.Ref },
};

class Button extends Component {}

Button.schema = {
  // button states: [resting, pressed, fully_pressed, recovering]
  currState: { type: Types.String, default: "resting" },
  prevState: { type: Types.String, default: "resting" },
  pressSound: { type: Types.Ref, default: null },
  releaseSound: { type: Types.Ref, default: null },
  restingY: { type: Types.Number, default: null },
  surfaceY: { type: Types.Number, default: null },
  recoverySpeed: { type: Types.Number, default: 0.4 },
  fullPressDistance: { type: Types.Number, default: null },
  action: { type: Types.Ref, default: () => {} },
};

class ButtonSystem extends System {
  init(attributes) {
    this.renderer = attributes.renderer;
    this.soundAdded = false;
  }

  execute(/*delta, time*/) {
    let buttonPressSound, buttonReleaseSound;
    if (this.renderer.xr.getSession() && !this.soundAdded) {
      const xrCamera = this.renderer.xr.getCamera();

      const listener = new THREE.AudioListener();
      xrCamera.add(listener);

      // create a global audio source
      buttonPressSound = new THREE.Audio(listener);
      buttonReleaseSound = new THREE.Audio(listener);

      // load a sound and set it as the Audio object's buffer
      const audioLoader = new THREE.AudioLoader();
      audioLoader.load("sounds/button-press.ogg", function (buffer) {
        buttonPressSound.setBuffer(buffer);
      });
      audioLoader.load("sounds/button-release.ogg", function (buffer) {
        buttonReleaseSound.setBuffer(buffer);
      });
      this.soundAdded = true;
    }

    this.queries.buttons.results.forEach((entity) => {
      const button = entity.getMutableComponent(Button);
      const buttonMesh = entity.getComponent(Object3D).object;
      // populate restingY
      if (button.restingY == null) {
        button.restingY = buttonMesh.position.y;
      }

      if (buttonPressSound) {
        button.pressSound = buttonPressSound;
      }

      if (buttonReleaseSound) {
        button.releaseSound = buttonReleaseSound;
      }

      if (
        button.currState == "fully_pressed" &&
        button.prevState != "fully_pressed"
      ) {
        button.pressSound?.play();
        button.action();
      }

      if (
        button.currState == "recovering" &&
        button.prevState != "recovering"
      ) {
        button.releaseSound?.play();
      }

      // preserve prevState, clear currState
      // FingerInputSystem will update currState
      button.prevState = button.currState;
      button.currState = "resting";
    });
  }
}

ButtonSystem.queries = {
  buttons: {
    components: [Button],
  },
};

class Pressable extends TagComponent {}

class FingerInputSystem extends System {
  init(attributes) {
    this.hands = attributes.hands;
  }

  execute(delta /*, time*/) {
    this.queries.pressable.results.forEach((entity) => {
      const button = entity.getMutableComponent(Button);
      const object = entity.getComponent(Object3D).object;
      const pressingDistances = [];
      this.hands.forEach((hand) => {
        if (hand && hand.intersectBoxObject(object)) {
          const pressingPosition = hand.getPointerPosition();
          pressingDistances.push(
            button.surfaceY - object.worldToLocal(pressingPosition).y
          );
        }
      });
      if (pressingDistances.length == 0) {
        // not pressed this frame

        if (object.position.y < button.restingY) {
          object.position.y += button.recoverySpeed * delta;
          button.currState = "recovering";
        } else {
          object.position.y = button.restingY;
          button.currState = "resting";
        }
      } else {
        button.currState = "pressed";
        const pressingDistance = Math.max(pressingDistances);
        if (pressingDistance > 0) {
          object.position.y -= pressingDistance;
        }

        if (object.position.y <= button.restingY - button.fullPressDistance) {
          button.currState = "fully_pressed";
          object.position.y = button.restingY - button.fullPressDistance;
        }
      }
    });
  }
}

FingerInputSystem.queries = {
  pressable: {
    components: [Pressable],
  },
};

//----------[---------------]--------

class NeedCalibration extends TagComponent {}

class CalibrationSystem extends System {
  init(attributes) {
    this.camera = attributes.camera;
    this.renderer = attributes.renderer;
  }

  execute(/*delta, time*/) {
    this.queries.needCalibration.results.forEach((entity) => {
      if (this.renderer.xr.getSession()) {
        const offset = entity.getComponent(OffsetFromCamera);
        const object = entity.getComponent(Object3D).object;
        const xrCamera = this.renderer.xr.getCamera();
        object.position.x = xrCamera.position.x + offset.x;
        object.position.y = xrCamera.position.y + offset.y;
        object.position.z = xrCamera.position.z + offset.z;
        entity.removeComponent(NeedCalibration);
      }
    });
  }
}

CalibrationSystem.queries = {
  needCalibration: {
    components: [NeedCalibration],
  },
};

//-----------------------------------
const world = new World();

function makeButtonMesh(x, y, z, color) {
  const geometry = new THREE.BoxGeometry(x, y, z);
  const material = new THREE.MeshPhongMaterial({ color: color });
  const buttonMesh = new THREE.Mesh(geometry, material);
  buttonMesh.castShadow = true;
  buttonMesh.receiveShadow = true;
  return buttonMesh;
}
//------------------Button System
const container = document.createElement("div");
document.body.appendChild(container);

//Controller sector
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let hand1, hand2; //hand variable
let raycaster;
//

//Object Collision
const tmpVector1 = new THREE.Vector3();
const tmpVector2 = new THREE.Vector3();

let group;

const scaling = {
  active: false,
  initialDistance: 0,
  object: null,
  initialScale: 1,
};

//

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  10000
);
camera.position.set(0, 8, 8);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4b67a6);

scene.add(new THREE.HemisphereLight(0x606060, 0x404040));

const light = new THREE.DirectionalLight(0xffffff);
light.position.set(1, 1, 1).normalize();
scene.add(light);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.update();

const stats = Stats();
container.appendChild(stats.dom);

const intersected = [];
const tempMatrix = new THREE.Matrix4();

initScene();
setupVR();
animate();

window.addEventListener("resize", resize.bind(this));

renderer.setAnimationLoop(render.bind(this));

function initScene() {
  const room = new THREE.LineSegments(
    new BoxLineGeometry(6, 6, 6, 10, 10, 10),
    new THREE.LineBasicMaterial({ color: 0x808080 })
  );
  room.geometry.translate(0, 3, 0);
  scene.add(room);

  controller1 = renderer.xr.getController(0);
  controller1.addEventListener("selectstart", onSelectStart);
  controller1.addEventListener("selectend", onSelectEnd);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener("selectstart", onSelectStart);
  controller2.addEventListener("selectend", onSelectEnd);
  scene.add(controller2);

  const controllerModelFactory = new XRControllerModelFactory();
  const handModelFactory = new XRHandModelFactory();
  //Left controller setting
  controllerGrip1 = renderer.xr.getControllerGrip(0);
  controllerGrip1.add(
    controllerModelFactory.createControllerModel(controllerGrip1)
  );
  scene.add(controllerGrip1);

  hand1 = renderer.xr.getHand(0);
  const handModel1 = new OculusHandModel(hand1);
  hand1.add(handModel1);
  scene.add(hand1);

  //
  // Rgight controller setting
  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(
    controllerModelFactory.createControllerModel(controllerGrip2)
  );

  scene.add(controllerGrip2);
  hand2 = renderer.xr.getHand(1);
  const handModel2 = new OculusHandModel(hand2);
  hand2.add(handModel2);
  scene.add(hand2);
  //

  // White line tracking controller helper
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  group = new THREE.Group();
  scene.add(group);
  const line = new THREE.Line(geometry);
  line.name = "line";
  line.scale.z = 5;

  controller1.add(line.clone());
  controller2.add(line.clone());

  raycaster = new THREE.Raycaster();
  //
  const floorGeometry = new THREE.PlaneGeometry(4, 4);
  const floorMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const consoleGeometry = new THREE.BoxGeometry(0.5, 0.12, 0.15);
  const consoleMaterial = new THREE.MeshPhongMaterial({ color: 0x505050 });
  const consoleMesh = new THREE.Mesh(consoleGeometry, consoleMaterial);
  consoleMesh.position.set(0, 1, -0.3);
  consoleMesh.castShadow = true;
  consoleMesh.receiveShadow = true;
  scene.add(consoleMesh);

  const orangeButton = makeButtonMesh(0.08, 0.1, 0.08, 0xffd3b5);
  orangeButton.position.set(-0.15, 0.04, 0);
  consoleMesh.add(orangeButton);

  const pinkButton = makeButtonMesh(0.08, 0.1, 0.08, 0xe84a5f);
  pinkButton.position.set(-0.05, 0.04, 0);
  consoleMesh.add(pinkButton);

  const resetButton = makeButtonMesh(0.08, 0.1, 0.08, 0x355c7d);

  resetButton.position.set(0.05, 0.04, 0);
  consoleMesh.add(resetButton);

  const exitButton = makeButtonMesh(0.08, 0.1, 0.08, 0xff0000);

  exitButton.position.set(0.15, 0.04, 0);
  consoleMesh.add(exitButton);

  world
    .registerComponent(Object3D)
    .registerComponent(Button)
    .registerComponent(Pressable)
    .registerComponent(NeedCalibration);

  world
    .registerSystem(CalibrationSystem, { renderer: renderer, camera: camera })
    .registerSystem(ButtonSystem, { renderer: renderer, camera: camera })
    .registerSystem(FingerInputSystem, { hands: [handModel1, handModel2] });

  const csEntity = world.createEntity();
  csEntity.addComponent(NeedCalibration);
  csEntity.addComponent(Object3D, { object: consoleMesh });

  const obEntity = world.createEntity();
  obEntity.addComponent(Pressable);
  obEntity.addComponent(Object3D, { object: orangeButton });
  const obAction = function () {};

  obEntity.addComponent(Button, {
    action: obAction,
    surfaceY: 0.05,
    fullPressDistance: 0.02,
  });

  const pbEntity = world.createEntity();
  pbEntity.addComponent(Pressable);
  pbEntity.addComponent(Object3D, { object: pinkButton });
  const pbAction = function () {};

  pbEntity.addComponent(Button, {
    action: pbAction,
    surfaceY: 0.05,
    fullPressDistance: 0.02,
  });

  const rbEntity = world.createEntity();
  rbEntity.addComponent(Pressable);
  rbEntity.addComponent(Object3D, { object: resetButton });
  const rbAction = function () {
    torusKnot.material.color.setHex(0xffffff);
  };

  rbEntity.addComponent(Button, {
    action: rbAction,
    surfaceY: 0.05,
    fullPressDistance: 0.02,
  });

  const ebEntity = world.createEntity();
  ebEntity.addComponent(Pressable);
  ebEntity.addComponent(Object3D, { object: exitButton });
  const ebAction = function () {
    exitText.visible = true;
    setTimeout(function () {
      exitText.visible = false;
      renderer.xr.getSession().end();
    }, 2000);
  };

  ebEntity.addComponent(Button, {
    action: ebAction,
    surfaceY: 0.05,
    recoverySpeed: 0.2,
    fullPressDistance: 0.03,
  });

  const loader = new TGALoader();
  const texture = loader.load(
    "./model/material/polys.tga",
    function (texture) {
      ``;
      console.log("Texture is loaded");
    },
    function (xhr) {
      console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    function (error) {
      console.log("An error happened");
    }
  );
  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    map: texture,
    side: THREE.BackSide, // This allow the texture disappear on both side
  });
  material.side = THREE.FrontSide;
  // load .fbx model
  let genralSize = 0.002;
  const fbxLoader = new FBXLoader();
  fbxLoader.load(
    "./organ.fbx",
    (object) => {
      object.traverse(function (child) {
        if (child.isMesh) {
          child.material = material;
          child.scale.set(genralSize, genralSize, genralSize);
          child.position.x = 0;
          child.position.y = 1;
          child.position.z = -1.5;
          room.add(child);
        }
        group.add(child); // Dragging the child object from the
      });
    },
    (xhr) => {
      console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    (error) => {
      console.log(error);
    }
  );
  console.log(material);
}

function setupVR() {
  renderer.xr.enabled = true;
  document.body.appendChild(VRButton.createButton(renderer));
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function render() {
  stats.update();
  cleanIntersected();
  intersectObjects(controller1);
  intersectObjects(controller2);

  renderer.render(scene, camera);
}

function onSelectStart(event) {
  const controller = event.target;

  const intersections = getIntersections(controller);

  if (intersections.length > 0) {
    const intersection = intersections[0];

    const object = intersection.object;
    object.material.emissive.b = 2;
    controller.attach(object);

    controller.userData.selected = object;
  }
}

function onSelectEnd(event) {
  const controller = event.target;

  if (controller.userData.selected !== undefined) {
    const object = controller.userData.selected;
    object.material.emissive.b = 0;
    group.attach(object);

    controller.userData.selected = undefined;
  }
}

function getIntersections(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);

  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  return raycaster.intersectObjects(group.children, false);
}

function intersectObjects(controller) {
  // Do not highlight when already selected

  if (controller.userData.selected !== undefined) return;

  const line = controller.getObjectByName("line");
  const intersections = getIntersections(controller);

  if (intersections.length > 0) {
    const intersection = intersections[0];

    const object = intersection.object;
    //object.material.emissive.r = 1; higrlight object
    intersected.push(object);

    line.scale.z = intersection.distance;
  } else {
    line.scale.z = 5;
  }
}

function cleanIntersected() {
  while (intersected.length) {
    const object = intersected.pop();
    object.material.emissive.r = 0;
  }
}

//
const SphereRadius = 0.05;
function onPinchStartLeft(event) {
  const controller = event.target;

  if (grabbing) {
    const indexTip = controller.joints["index-finger-tip"];
    const sphere = collideObject(indexTip);

    if (sphere) {
      const sphere2 = hand2.userData.selected;
      console.log("sphere1", sphere, "sphere2", sphere2);
      if (sphere === sphere2) {
        scaling.active = true;
        scaling.object = sphere;
        scaling.initialScale = sphere.scale.x;
        scaling.initialDistance = indexTip.position.distanceTo(
          hand2.joints["index-finger-tip"].position
        );
        return;
      }
    }
  }

  const geometry = new THREE.BoxGeometry(
    SphereRadius,
    SphereRadius,
    SphereRadius
  );
  const material = new THREE.MeshStandardMaterial({
    color: Math.random() * 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
  });
  const spawn = new THREE.Mesh(geometry, material);
  spawn.geometry.computeBoundingSphere();

  const indexTip = controller.joints["index-finger-tip"];
  spawn.position.copy(indexTip.position);
  spawn.quaternion.copy(indexTip.quaternion);

  spheres.push(spawn);

  scene.add(spawn);
}

function collideObject(indexTip) {
  for (let i = 0; i < spheres.length; i++) {
    const sphere = spheres[i];
    const distance = indexTip
      .getWorldPosition(tmpVector1)
      .distanceTo(sphere.getWorldPosition(tmpVector2));

    if (distance < sphere.geometry.boundingSphere.radius * sphere.scale.x) {
      return sphere;
    }
  }

  return null;
}

//
function animate() {
  renderer.setAnimationLoop(render);
}
