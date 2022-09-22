import * as THREE from "/build/three.module.js";
import Stats from "./jsm/libs/stats.module.js";
import { OrbitControls } from "./jsm/controls/OrbitControls.js";
import { FBXLoader } from "./jsm/loaders/FBXLoader.js";
import { TGALoader } from "./jsm/loaders/TGALoader.js";
import { VRButton } from "./jsm/webxr/VRButton.js";
import { BoxLineGeometry } from "./jsm/geometries/BoxLineGeometry.js";
import { XRControllerModelFactory } from "./jsm/webxr/XRControllerModelFactory.js"; //controller models
import { XRHandModelFactory } from "./jsm/webxr/XRHandModelFactory.js"; //hand models

const container = document.createElement("div");
document.body.appendChild(container);

//Controller sector
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let hand1, hand2; //hand variable
let raycaster;
const clock = new THREE.Clock();
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
scene.background = new THREE.Color(0x505050);

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

  hand1.add(handModelFactory.createHandModel(hand1));

  scene.add(hand1);

  //
  // Rgight controller setting
  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(
    controllerModelFactory.createControllerModel(controllerGrip2)
  );
  scene.add(controllerGrip2);
  hand2 = renderer.xr.getHand(1);

  hand2.add(handModelFactory.createHandModel(hand2));
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
    side: THREE.DoubleSide, // This allow the texture disappear on both side
  });
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
    object.material.emissive.r = 1;
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

function onPinchStartRight(event) {
  const controller = event.target;
  const indexTip = controller.joints["index-finger-tip"];
  const object = collideObject(indexTip);
  if (object) {
    grabbing = true;
    indexTip.attach(object);
    controller.userData.selected = object;
    console.log("Selected", object);
  }
}

function onPinchEndRight(event) {
  const controller = event.target;

  if (controller.userData.selected !== undefined) {
    const object = controller.userData.selected;
    object.material.emissive.b = 0;
    scene.attach(object);

    controller.userData.selected = undefined;
    grabbing = false;
  }

  scaling.active = false;
}
//
function animate() {
  renderer.setAnimationLoop(render);
}
