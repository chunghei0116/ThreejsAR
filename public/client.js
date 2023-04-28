import * as THREE from "/build/three.module.js";
import { OrbitControls } from "./jsm/controls/OrbitControls.js";
import { FBXLoader } from "./jsm/loaders/FBXLoader.js";
import { TGALoader } from "./jsm/loaders/TGALoader.js";
import { ARButton } from "./jsm/webxr/ARButton.js";

let container;
let camera, scene, renderer;
let controller1, controller2;

let raycaster;

const intersected = [];
const tempMatrix = new THREE.Matrix4();

let group;

init();
animate();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    10
  );
  camera.position.set(0, 0, 3);

  const controls = new OrbitControls(camera, container);
  controls.minDistance = 0;
  controls.maxDistance = 8;

  scene.add(new THREE.HemisphereLight(0x808080, 0x606060));

  const light = new THREE.DirectionalLight(0xffffff);
  light.position.set(0, 6, 0);
  scene.add(light);

  group = new THREE.Group();
  scene.add(group);

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
    side: THREE.FrontSide, // This allowes the texture rendering
  });

  // load .fbx model
  let genralSize = 0.0009;
  var fbxLoader = new FBXLoader();
  fbxLoader.load(
    "./organ.fbx",
    (object) => {
      object.traverse(function (child) {
        if (child.isMesh) {
          child.material = material;
          child.scale.set(genralSize, genralSize, genralSize);
          child.position.x = -0.5;
          child.position.y = -0.2;
          child.position.z = -1;
        }
        group.add(child);
        group.add(object); // Dragging the child object from the
      });
    },
    (xhr) => {
      console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    (error) => {
      console.log(error);
    }
  );

  fbxLoader.load(
    "./brain.fbx",
    (object) => {
      object.traverse(function (child) {
        if (child.isMesh) {
          child.material = material;
          child.scale.set(0.07, 0.07, 0.07);
          child.position.x = 1;
          child.position.y = -0.2;
          child.position.z = -1;
          child.rotation.y = 90;
        }
        group.add(child);
        group.add(object); // Dragging the child object from the
      });
    },
    (xhr) => {
      console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    (error) => {
      console.log(error);
    }
  );

  /* fbxLoader.load("./mamoth.fbx", (object) => {
    scene.add(object);
    object.scale.multiplyScalar(0.001);
    object.position.x = 0.5;
    object.position.y = -3;
    object.position.z = -7;
    object.rotation.y = 90;
  }); */

  //

  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true }); //Opti
  renderer.setPixelRatio(window.devicePixelRatio * 0.8);

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  document.body.appendChild(ARButton.createButton(renderer));

  // controllers

  controller1 = renderer.xr.getController(0);
  controller1.addEventListener("selectstart", onSelectStart);
  controller1.addEventListener("selectend", onSelectEnd);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener("selectstart", onSelectStart);
  controller2.addEventListener("selectend", onSelectEnd);
  scene.add(controller2);

  raycaster = new THREE.Raycaster();
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  let linegroup = new THREE.Group();
  scene.add(linegroup);
  const line = new THREE.Line(geometry);
  line.name = "line";
  line.scale.z = 5;

  controller1.add(line.clone());
  controller2.add(line.clone());

  //

  window.addEventListener("resize", onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelectStart(event) {
  const controller = event.target;

  const intersections = getIntersections(controller);

  if (intersections.length > 0) {
    const intersection = intersections[0];

    const object = intersection.object;
    object.material.emissive.b = 0.5;

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

  const intersections = getIntersections(controller);

  if (intersections.length > 0) {
    const intersection = intersections[0];
    const object = intersection.object;
    intersected.push(object);
  }
}

function cleanIntersected() {
  while (intersected.length) {
    const object = intersected.pop();
    object.material.emissive.r = 0;
  }
}

//

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  cleanIntersected();

  intersectObjects(controller1);
  intersectObjects(controller2);

  renderer.render(scene, camera);
}
