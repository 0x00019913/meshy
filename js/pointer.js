var Pointer = (function() {

  function Pointer(camera, domElement, scene) {
    // these are required for raycasting
    this.camera = camera;
    this.domElement = domElement;
    // for displaying the cursor
    this.scene = scene;

    this.meshes = [];
    this.active = false;

    this.raycaster = new THREE.Raycaster();

    // contains functions invoked on mouse up
    this.clickCallbacks = [];

    // create the cursors
    this.cursor = null;

    this.cursorColor = 0xcccccc;
    this.cursorColorDown = 0x2adeff;

    // mouse interaction

    var _this = this;

    // pointer object; not null when mouse is down
    this.mousedownPointer = null;

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

    addMesh: function(mesh) {
      this.meshes.push(mesh);
      return this;
    },

    removeMesh: function(mesh) {
      var idx = this.meshes.indexOf(mesh);

      if (idx > -1) this.meshes.splice(idx);

      return this;
    },

    removeMeshes: function() {
      this.meshes.length = 0;
      return this;
    },

    activate: function() {
      // if cursor is not set, default to circle
      if (this.cursor === null) {
        this.setCursorCircle();
      }

      this.cursor.addToScene(this.scene);
      this.active = true;

      return this;
    },

    deactivate: function() {
      // clear callbacks
      this.clickCallbacks.length = 0;

      // make inactive and invisible
      this.active = false;

      if (this.cursor) {
        this.cursor.deactivate();
        this.cursor.removeFromScene();
        this.cursor = null;
      }

      return this;
    },

    setCursorCircle: function() {
      this.cursor = new Markers.CircleMarker().setColor(this.cursorColor);

      return this;
    },

    setCursorPointer: function() {
      this.cursor = new Markers.PointerMarker().setColor(this.cursorColor);

      return this;
    },

    setCursorNull: function() {
      this.cursor = null;

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
      if (!this.active) return;

      this.raycaster.setFromCamera(pointer.coords, this.camera);

      var intersects = this.raycaster.intersectObjects(this.meshes, false);

      // if intersecting mesh, get the first intersection
      if (intersects.length > 0) {
        var intersection = intersects[0];

        // get the normal in world space
        var rotation = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld);
        var normal = intersection.face.normal.clone().applyMatrix3(rotation);
        var point = intersection.point;
        var cursor = this.cursor;

        cursor.setPosition(point);
        cursor.setNormal(normal);
        cursor.activate();
        this.updateCursor();

        this.intersection = intersection;
      }
      else {
        this.cursor.deactivate();

        this.intersection = null;
      }
    },

    mousedown: function(pointer) {
      if (!this.active) return;
      if (!this.intersection || pointer.button !== 0) return;

      this.mousedownPointer = pointer;
      if (this.cursor) this.cursor.setColor(this.cursorColorDown);
    },

    mouseup: function(pointer) {
      if (!this.active) return;
      if (!this.mousedownPointer || !this.intersection) return;

      var dist = pointer.pixelCoords.distanceTo(this.mousedownPointer.pixelCoords);

      if (dist < this.clickAllowance) {
        for (var c = 0; c < this.clickCallbacks.length; c++) {
          this.clickCallbacks[c](this.intersection);
        }
      }

      this.mousedownPointer = null;
      if (this.cursor) this.cursor.setColor(this.cursorColor);
    },

    updateCursor: function() {
      var cursor = this.cursor;

      if (!this.active || !cursor.active) return;

      var dist = cursor.getPosition().distanceTo(this.camera.position);

      cursor.setScale(dist * 0.005);
    }

  });

  return Pointer;

})();
