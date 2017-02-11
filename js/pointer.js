Pointer = function(scene, camera, domElement) {
  this.scene = scene;
  this.camera = camera;
  this.domElement = domElement;

  this.raycaster = new THREE.Raycaster();

  this.mouse = new THREE.Vector2();

  /*
  var cursorGeo = new THREE.CircleGeometry(.05,32);
  var cursorMat = new THREE.MeshBasicMaterial({color: 0xdddddd});
  this.cursor = new THREE.Mesh(cursorGeo, cursorMat);
  this.cursor.name = "cursor";
  this.cursor.visible = false;
  scene.add(this.cursor);*/

  var r = 0.05;
  this.cursorRadius = r;
  this.cursorSegments = 32;
  var cursorGeo = new THREE.Geometry();
  var cursorMat = new THREE.LineBasicMaterial({color: 0x0});
  var thetaIncrement = 2 * Math.PI / this.cursorSegments;
  for (var i=0; i<=this.cursorSegments; i++) {
    var theta = i * thetaIncrement;
    var thetaNext = (i+1) * thetaIncrement;
    cursorGeo.vertices.push(new THREE.Vector3(r * Math.cos(theta), r* Math.sin(theta), 0));
  }
  this.cursor = new THREE.Line(cursorGeo, cursorMat);
  this.cursor.name = "cursor";
  this.cursor.visible = false;
  scene.add(this.cursor);

  domElement.addEventListener('mousemove', onMouseMove, false);

  var _this = this;
  function onMouseMove(e) {
    _this.mouse.x = (e.clientX/_this.domElement.offsetWidth)*2 - 1;
    _this.mouse.y = 1 - (e.clientY/_this.domElement.offsetHeight)*2;

    _this.update();
  }
}

Pointer.prototype.update = function() {
  this.raycaster.setFromCamera(this.mouse, this.camera);
  var intersects = this.raycaster.intersectObjects(this.scene.children);
  var intersectsMesh = false;

  for (var i=0; i<intersects.length; i++) {
    if (intersects[i].object.name=="model") {
      var pt = intersects[i].point;
      this.cursor.position.copy(pt);
      this.cursor.lookAt(pt.add(intersects[i].face.normal));

      this.cursor.visible = true;
      intersectsMesh = true;

      break;
    }
  }
  if (!intersectsMesh) {
    this.cursor.visible = false;
  }
}
