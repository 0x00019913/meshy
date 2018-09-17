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
    this.cursors = [];
    this.cursorIdx = 0;

    this.cursorColor = 0xcccccc;
    this.cursorColorDown = 0x2adeff;
    var cursorSegments = 32;

    // circle cursor
    var cursor0Geo = new THREE.Geometry();
    var cursor0Mat = new THREE.LineBasicMaterial({ color: this.cursorColor });
    var dtheta = 2 * Math.PI / cursorSegments;

    for (var i = 0; i <= cursorSegments; i++) {
      var theta = i * dtheta;
      cursor0Geo.vertices.push(new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0));
    }

    this.cursors.push(new THREE.Line(cursor0Geo, cursor0Mat));

    // normal-pointing arrow cursor
    var cursor1ConeBufferGeo = new THREE.ConeBufferGeometry(0.75, 3.0, cursorSegments);
    cursor1ConeBufferGeo.rotateX(Math.PI / 2);
    cursor1ConeBufferGeo.translate(0, 0, 3.0);
    var cursor1SphereBufferGeo = new THREE.SphereBufferGeometry(0.75, cursorSegments, cursorSegments / 2);

    var cursor1Geo = new THREE.Geometry();
    cursor1Geo.merge(new THREE.Geometry().fromBufferGeometry(cursor1ConeBufferGeo));
    cursor1Geo.merge(new THREE.Geometry().fromBufferGeometry(cursor1SphereBufferGeo));

    var cursor1Mat = new THREE.MeshStandardMaterial({
      color: this.cursorColor,
      roughness: 0.0,
      metalness: 0.5
    });
    this.cursors.push(new THREE.Mesh(cursor1Geo, cursor1Mat))

    for (var c = 0; c < this.cursors.length; c++) {
      var cursor = this.cursors[c];

      cursor.name = "cursor";
      cursor.visible = false;
      this.scene.add(cursor);
    }

    // mouse interaction

    var _this = this;

    // pixel coords of the mousedown event, if the button is currently down
    this.clickPixelCoords = null;

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
      this.active = true;

      return this;
    },

    deactivate: function() {
      // clear callbacks
      this.clickCallbacks.length = 0;

      // make inactive and invisible
      this.active = false;
      this.getCursor().visible = false;

      return this;
    },

    setCursor: function(idx) {
      this.cursorIdx = clamp(idx, 0, this.cursors.length - 1);

      return this;
    },

    getCursor: function() {
      return this.cursors[this.cursorIdx];
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

        var cursor = this.getCursor();

        cursor.position.copy(point);
        cursor.lookAt(point.clone().add(normal));
        cursor.visible = true;
        this.updateCursor();

        this.intersection = intersection;
      }
      else {
        this.getCursor().visible = false;

        this.intersection = null;
      }
    },

    mousedown: function(pointer) {
      if (!this.active) return;
      if (!this.intersection) return;
      if (pointer.button !== 0) return;

      this.clickPixelCoords = pointer.pixelCoords;
      this.getCursor().material.color.set(this.cursorColorDown);
    },

    mouseup: function(pointer) {
      if (!this.active) return;
      if (!this.clickPixelCoords) return;
      if (!this.intersection) return;

      var dist = pointer.pixelCoords.distanceTo(this.clickPixelCoords);
      if (dist < this.clickAllowance) {
        for (var c = 0; c < this.clickCallbacks.length; c++) {
          // the commented-out code is used for testing BufferGeometry stuff
          
          //var object = this.intersection.object;
          //var geo = object.geometry;
          //var buffergeo = new THREE.BufferGeometry().fromGeometry(geo);
          //object.geometry = buffergeo;
          this.clickCallbacks[c](this.intersection);
          //object.geometry = geo;
        }
      }

      this.clickPixelCoords = null;
      this.getCursor().material.color.set(this.cursorColor);
    },

    updateCursor: function() {
      var cursor = this.getCursor();

      if (!this.active || !cursor.visible) return;

      var dist = cursor.position.distanceTo(this.camera.position);

      cursor.scale.setScalar(dist * 0.005);
    }

  });

  return Pointer;

})();
