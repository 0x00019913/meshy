Pointer = function(scene, camera, domElement) {
  this.scene = scene;
  this.camera = camera;
  this.domElement = domElement;
  this.active = false;

  this.raycaster = new THREE.Raycaster();

  this.mouse = new THREE.Vector2();
  this.clickCallbacks = new KeyStack();
  // pixel difference between mousedown and mouseup for a mouse press
  // to count as a click
  this.clickAllowance = 5;
  this.cursorColor = 0xff0000;
  this.cursorColorDown = 0xffff00;

  this.scale = 1;
  var r = 0.05;
  this.cursorRadius = r;
  this.cursorSegments = 32;
  var cursorGeo = new THREE.Geometry();
  var cursorMat = new THREE.LineBasicMaterial({color: this.cursorColor});
  var thetaIncrement = 2 * Math.PI / this.cursorSegments;
  for (var i=0; i<=this.cursorSegments; i++) {
    var theta = i * thetaIncrement;
    cursorGeo.vertices.push(new THREE.Vector3(r*Math.cos(theta), r*Math.sin(theta), 0));
  }
  this.cursor = new THREE.Line(cursorGeo, cursorMat);
  this.cursor.name = "cursor";
  this.cursor.visible = false;
  scene.add(this.cursor);

  domElement.addEventListener('mousemove', onMouseMove, false);
  domElement.addEventListener('mousedown', onMouseDown, false);
  domElement.addEventListener('mouseup', onMouseUp, false);

  var _this = this;
  var clickLocation = new THREE.Vector2();
  function onMouseMove(e) {
    if (!_this.active) return;
    _this.mouse.x = (e.clientX/_this.domElement.offsetWidth)*2 - 1;
    _this.mouse.y = 1 - (e.clientY/_this.domElement.offsetHeight)*2;

    _this.update();
  }

  function onMouseDown(e) {
    if (!_this.active) return;

    _this.cursor.material.color.set(_this.cursorColorDown);
    clickLocation.x = e.clientX;
    clickLocation.y = e.clientY;
  }

  function onMouseUp(e) {
    if (!_this.active) return;
    if (_this.clickCallbacks.empty() || !_this.intersection) return;

    _this.cursor.material.color.set(_this.cursorColor);
    clickLocation.x -= e.clientX;
    clickLocation.y -= e.clientY;
    if (clickLocation.length()<_this.clickAllowance && _this.intersection) {
      _this.clickCallbacks.callEachWithArg(_this.intersection);
      _this.intersection = null;
    }
  }
}

Pointer.prototype.setScale = function(scale) {
  this.scale = scale;
  this.cursor.scale.set(scale, scale, scale);
}

Pointer.prototype.addClickCallback = function(callback) {
  return this.clickCallbacks.add(callback);
}

Pointer.prototype.removeClickCallback = function(idx) {
  this.clickCallbacks.remove(idx);
}

Pointer.prototype.update = function() {
  this.raycaster.setFromCamera(this.mouse, this.camera);
  var intersects = this.raycaster.intersectObjects(this.scene.children);
  var intersectsMesh = false;

  // position cursor at surface plus (surface normal times this factor);
  // will offset the cursor from the surface by 0.125*cursorRadius
  var offsetFactor = this.scale * this.cursorRadius * 0.125;

  for (var i=0; i<intersects.length; i++) {
    if (intersects[i].object.name=="model") {
      this.intersection = intersects[i];
      var normal = intersects[i].face.normal;
      // intersection point offset slightly from the surface
      var point = intersects[i].point.clone();
      point.add(normal.clone().multiplyScalar(offsetFactor));
      this.cursor.position.copy(point);
      this.cursor.lookAt(point.add(normal));

      this.cursor.visible = true;
      intersectsMesh = true;

      break;
    }
  }
  if (!intersectsMesh) {
    this.cursor.visible = false;
    this.intersection = null;
  }
}
