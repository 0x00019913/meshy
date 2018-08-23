var Pointer = (function() {

  function Pointer(camera, domElement, scene) {
    // these are required for raycasting
    this.camera = camera;
    this.domElement = domElement;
    // for displaying the cursor
    this.scene = scene;

    this.model = null;
    this.active = false;

    this.raycaster = new THREE.Raycaster();

    // contains functions invoked on mouse up
    this.clickCallbacks = [];

    // cursor mesh
    this.cursorColor = 0x999999;
    this.cursorColorDown = 0xffff00;
    this.cursorSegments = 32;

    var cursorGeo = new THREE.Geometry();
    var cursorMat = new THREE.LineBasicMaterial({color: this.cursorColor});
    var dtheta = 2 * Math.PI / this.cursorSegments;

    for (var i = 0; i <= this.cursorSegments; i++) {
      var theta = i * dtheta;
      cursorGeo.vertices.push(new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0));
    }

    this.cursor = new THREE.Line(cursorGeo, cursorMat);
    this.cursor.name = "cursor";
    this.cursor.visible = false;

    this.scene.add(this.cursor);

    // mouse interaction

    var _this = this;

    // pixel coords of the mousedown event, if the button is currently down
    var clickCoords = null;

    // allowance in pixels between the mousedown and mouseup events - determines
    // whether a click counts or not
    this.clickAllowance = 5;

    // intersection object returned by raycasting if the cursor currently
    // intersects mesh, else null
    this.intersection = null;

    domElement.addEventListener('mousemove', mousemove, false);
    domElement.addEventListener('mousedown', mousedown, false);
    domElement.addEventListener('mouseup', mouseup, false);

    // collect normalized screen coordinates and keys/button pressed
    function getPointer(event) {
      var r = domElement.getBoundingClientRect();

      var cx = event.clientX - r.left;
      var cy = event.clientY - r.top;
      var x = (cx / r.width) * 2 - 1;
      var y = -((cy / r.height) * 2 - 1);

      return {
        pixelCoords: new THREE.Vector2(cx, cy),
        coords: new THREE.Vector2(x, y),
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        button: event.button
      };
    }

    function mousemove(event) {
      _this.mousemove(getPointer(event));
    }

    function mousedown(event) {
      _this.mousedown(getPointer(event));
    }

    function mouseup(event) {
      _this.mouseup(getPointer(event));
    }
  }

  Object.assign(Pointer.prototype, {

    setModel: function(model) {
      this.model = model;
      return this;
    },

    activate: function() {
      this.active = true;
      return this;
    },

    deactivate: function() {
      this.active = false;
      return this;
    },

    addClickCallback: function(callback) {
      var callbacks = this.clickCallbacks;
      var idx = callbacks.length;

      callbacks.push(callback);

      return idx;
    },

    removeClickCallback: function(idx) {
      this.clickCallbacks.splice(idx);
    },

    mousemove: function(pointer) {
      if (!this.active || !this.model) return;

      this.raycaster.setFromCamera(pointer.coords, this.camera);

      // recursive is false b/c model doesn't have children
      var intersects = this.raycaster.intersectObject(this.model, false);

      // if intersecting mesh, get the first intersection
      if (intersects.length > 0) {
        var intersection = intersects[0];
        var normal = intersection.face.normal;
        var point = intersection.point;

        this.cursor.position.copy(point);
        this.cursor.lookAt(point.clone().add(normal));
        this.cursor.visible = true;

        this.intersection = intersection;
      }
      else {
        this.cursor.visible = false;

        this.intersection = null;
      }
    },

    mousedown: function(pointer) {
      if (!this.active || !this.model) return;
      if (!this.intersection) return;
      if (pointer.button !== 0) return;

      this.clickCoords = pointer.pixelCoords;
      this.cursor.material.color.set(this.cursorColorDown);
    },

    mouseup: function(pointer) {
      if (!this.active || !this.model) return;
      if (!this.clickCoords) return;

      var dist = pointer.pixelCoords.distanceTo(this.clickCoords);
      if (dist < this.clickAllowance) {
        for (var c = 0; c < this.clickCallbacks.length; c++) {
          this.clickCallbacks[c](this.intersection);
        }
      }

      this.clickCoords = null;
      this.cursor.material.color.set(this.cursorColor);
    }

  });

  return Pointer;

})();
