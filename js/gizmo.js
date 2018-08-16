var Gizmo = (function() {

  function makeHandleName(axis, type) {
    return axis + '_' + type;
  }

  function parseHandleName(name) {
    var split = name.split('_');
    var typestr = split[1];
    var types = Gizmo.HandleTypes;
    var type = types.none;

    if (typestr === types.translate) type = types.translate;
    else if (typestr === types.rotate) type = types.rotate;
    else if (typestr === types.scale) type = types.scale;

    return {
      type: type,
      axis: split[0]
    };
  }

  function Gizmo(camera, domElement, params) {
    THREE.Object3D.call(this);

    this.camera = camera;
    this.domElement = domElement !== undefined ? domElement : document;

    this.visible = true; // todo: back to false

    // if some/all params are not provided, set defaults
    this.params = params || {};
    this.setDefaultParams();

    // color and material setup

    var activeFactor = 2;

    this.colors = {
      x: {}, y: {}, z: {}, o: {}
    };

    this.colors.x.inactive = new THREE.Color(0.30, 0.15, 0.15),
    this.colors.x.active = this.colors.x.inactive.clone().multiplyScalar(activeFactor);
    this.colors.y.inactive = new THREE.Color(0.15, 0.30, 0.15),
    this.colors.y.active = this.colors.y.inactive.clone().multiplyScalar(activeFactor);
    this.colors.z.inactive = new THREE.Color(0.15, 0.15, 0.30),
    this.colors.z.active = this.colors.z.inactive.clone().multiplyScalar(activeFactor);
    this.colors.o.inactive = new THREE.Color(0.20, 0.20, 0.20),
    this.colors.o.active = this.colors.o.inactive.clone().multiplyScalar(activeFactor);

    this.opacityInactive = 0.75;
    this.opacityActive = 1.0;

    var baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 1.0,
      metalness: 0.2,
      transparent: true,
      opacity: this.opacityInactive
    });

    // clone base material and give it the appropriate color

    this.materials = {
      x: baseMaterial.clone(),
      y: baseMaterial.clone(),
      z: baseMaterial.clone(),
      o: baseMaterial.clone()
    };
    this.materials.x.setValues({
      color: this.colors.x.inactive
    });
    this.materials.y.setValues({
      color: this.colors.y.inactive
    });
    this.materials.z.setValues({
      color: this.colors.z.inactive
    });
    this.materials.o.setValues({
      color: this.colors.o.inactive
    });

    // currently active handle and the point on which the mouse hit it
    this.activeHandle = null;
    this.activePoint = null;

    // interaction setup

    // used to determine mouse movement wrt the gizmo meshes
    this.raycaster = new THREE.Raycaster();

    // when dragging, gives the current transform type and axis
    this.transformType = Gizmo.HandleTypes.none;
    this.transformAxis = "";
    this.transformStart = null;

    // each group contains the handles of a particular type so that they can be
    // transformed together
    this.handleGroups = {};
    this.handleGroups[Gizmo.HandleTypes.translate] = new THREE.Group();
    this.handleGroups[Gizmo.HandleTypes.rotate] = new THREE.Group();
    this.handleGroups[Gizmo.HandleTypes.scale] = new THREE.Group();
    // special group for orthogonal handles because they don't need to be
    // transformed with the rest
    this.handleGroups.orthogonal = new THREE.Group();

    this.add(this.handleGroups.translate);
    this.add(this.handleGroups.rotate);
    this.add(this.handleGroups.scale);
    this.add(this.handleGroups.orthogonal);

    this.handles = {};
    this.handles[Gizmo.HandleTypes.translate] = {};
    this.handles[Gizmo.HandleTypes.rotate] = {};
    this.handles[Gizmo.HandleTypes.scale] = {};

    this.makeHandles();

    var _this = this;

    this.domElement.addEventListener('mousemove', mousemove, false);
    this.domElement.addEventListener('mousedown', mousedown, false);
    this.domElement.addEventListener('mouseup', mouseup, false);

    // collect normalized screen coordinates and keys/button pressed
    function getPointer(event) {
      var r = domElement.getBoundingClientRect();

      var x = ((event.clientX - r.left) / r.width) * 2 - 1;
      var y = -(((event.clientY - r.top) / r.height) * 2 - 1);

      return {
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

  Gizmo.HandleTypes = {
    none: "none",
    translate: "translate",
    rotate: "rotate",
    scale: "scale"
  };

  Gizmo.prototype = Object.create(THREE.Object3D.prototype);

  Object.assign(Gizmo.prototype, {

    constructor: Gizmo,

    setDefaultParams: function() {
      var params = this.params;

      setProp("scaleHandleRadius", 1.25);
      setProp("scaleHandleHeight", 2.5);
      setProp("scaleHandleRadialSegments", 32);
      setProp("scaleHandleOffset", 14);

      setProp("rotateHandleOuterRadius", 16.55);
      setProp("rotateHandleWidth", 0.6);
      setProp("rotateHandleHeight", 0.6);
      setProp("rotateHandleRadialSegments", 64);

      setProp("rotateOrthogonalHandleOuterRadius", 18.15);

      setProp("translateHandleRadius", 1.25);
      setProp("translateHandleHeight", 6);
      setProp("translateHandleRadialSegments", 32);
      setProp("translateHandleOffset", 22.15);

      setProp("scaleFactor", 0.003);

      // if params object doesn't contain a property, set it
      function setProp(name, val) {
        if (!params.hasOwnProperty(name)) params[name] = val;
      }
    },

    makeHandle: function(type, axis, material) {
      var geo;

      if (type === Gizmo.HandleTypes.translate) {
        geo = new THREE.ConeBufferGeometry(
          this.params.translateHandleRadius,
          this.params.translateHandleHeight,
          this.params.translateHandleRadialSegments
        );
      }
      else if (type === Gizmo.HandleTypes.rotate) {
        var outerRadius;
        if (axis === "o") {
          outerRadius = this.params.rotateOrthogonalHandleOuterRadius;
        }
        else {
          outerRadius = this.params.rotateHandleOuterRadius;
        }

        geo = new PipeBufferGeometry(
          outerRadius,
          outerRadius - this.params.rotateHandleWidth,
          this.params.rotateHandleHeight,
          this.params.rotateHandleRadialSegments
        );
      }
      else if (type === Gizmo.HandleTypes.scale) {
        geo = new THREE.CylinderBufferGeometry(
          this.params.scaleHandleRadius,
          this.params.scaleHandleRadius,
          this.params.scaleHandleHeight,
          this.params.scaleHandleRadialSegments
        );
      }
      else return;

      var mesh = new THREE.Mesh(geo, material.clone());

      // point the mesh in the right direction
      if (axis === "x") mesh.rotation.z = -Math.PI / 2;
      else if (axis === "z") mesh.rotation.x = Math.PI / 2;

      return mesh;
    },

    makeHandles: function() {
      var handle;

      // translate handles

      handle = this.makeHandle(Gizmo.HandleTypes.translate, "x", this.materials.x);
      handle.position.x = this.params.translateHandleOffset;
      handle.name = makeHandleName("x", Gizmo.HandleTypes.translate);
      this.handleGroups.translate.add(handle);
      this.handles.translate.x = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.translate, "y", this.materials.y);
      handle.position.y = this.params.translateHandleOffset;
      handle.name = makeHandleName("y", Gizmo.HandleTypes.translate);
      this.handleGroups.translate.add(handle);
      this.handles.translate.y = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.translate, "z", this.materials.z);
      handle.position.z = this.params.translateHandleOffset;
      handle.name = makeHandleName("z", Gizmo.HandleTypes.translate);
      this.handleGroups.translate.add(handle);
      this.handles.translate.z = handle;

      // rotate handles

      // x rotation
      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "x", this.materials.x);
      handle.name = makeHandleName("x", Gizmo.HandleTypes.rotate);
      this.handleGroups.rotate.add(handle);
      this.handles.rotate.x = handle;

      // y rotation
      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "y", this.materials.y);
      handle.name = makeHandleName("y", Gizmo.HandleTypes.rotate);
      this.handleGroups.rotate.add(handle);
      this.handles.rotate.y = handle;

      // z rotation
      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "z", this.materials.z);
      handle.name = makeHandleName("z", Gizmo.HandleTypes.rotate);
      this.handleGroups.rotate.add(handle);
      this.handles.rotate.z = handle;

      // o rotation
      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "o", this.materials.o);
      handle.name = makeHandleName("o", Gizmo.HandleTypes.rotate);
      this.handleGroups.orthogonal.add(handle);
      this.handles.rotate.o = handle;
      // rotate geometry to face up on z axis so that the lookat function works
      // correctly
      handle.rotation.x = Math.PI/2;
      handle.updateMatrix();
      handle.geometry.applyMatrix(handle.matrix);
      handle.rotation.x = 0;
      handle.updateMatrix();

      // scale handles

      handle = this.makeHandle(Gizmo.HandleTypes.scale, "x", this.materials.x);
      handle.name = makeHandleName("x", Gizmo.HandleTypes.scale);
      handle.position.x = this.params.scaleHandleOffset;
      this.handleGroups.scale.add(handle);
      this.handles.scale.x = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.scale, "y", this.materials.y);
      handle.position.y = this.params.scaleHandleOffset;
      handle.name = makeHandleName("y", Gizmo.HandleTypes.scale);
      this.handleGroups.scale.add(handle);
      this.handles.scale.y = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.scale, "z", this.materials.z);
      handle.position.z = this.params.scaleHandleOffset;
      handle.name = makeHandleName("z", Gizmo.HandleTypes.scale);
      this.handleGroups.scale.add(handle);
      this.handles.scale.z = handle;
    },

    update: function(position, rotation, scale) {
      var camPosProjected = this.camera.position.clone().sub(this.position);
      this.handleGroups.orthogonal.lookAt(camPosProjected);

      var distanceToCamera = this.position.distanceTo(this.camera.position);
      this.scale.setScalar(this.params.scaleFactor * distanceToCamera);

      // if new position given, set to this position
      if (position !== undefined) {
        this.position.copy(position);
      }
      // if new rotation given, set rotation of cardinal rotate handles and
      // scale handles to this rotation
      if (rotation !== undefined) {
        this.handleGroups[Gizmo.HandleTypes.rotate].rotation.copy(rotation);
        this.handleGroups[Gizmo.HandleTypes.scale].rotation.copy(rotation);
      }
      // don't do anything for scale
    },

    mousemove: function(pointer) {
      this.raycaster.setFromCamera(pointer.coords, this.camera);

      // if currently active transform
      if (this.transformType !== Gizmo.HandleTypes.none && this.transformAxis !== "") {
        this.transformmove();
      }
      // no currently active transform, so handle handle mouseover
      else {
        var raycaster = this.raycaster;

        var intersections = raycaster.intersectObjects(this.children, true);

        // intersecting some handle
        if (intersections.length > 0) {
          var dist = intersections[0].distance;
          var handle = null;

          for (var i = 0; i < intersections.length; i++) {
            var intersection = intersections[i];

            if (intersection.distance <= dist) {
              handle = intersection.object;
              this.activePoint = intersection.point;
            }
          }

          if (this.activeHandle !== handle) this.deactivateHandle();
          this.activateHandle(handle);
        }
        else {
          this.deactivateHandle();
        }
      }

    },

    mousedown: function(pointer) {
      if (pointer.button !== 0) return;

      var handle = this.activeHandle;

      if (handle !== null) {
        if (this.params.onTransform) this.params.onTransform();

        var nameParse = parseHandleName(handle.name);
        var type = nameParse.type;
        var axis = nameParse.axis;

        this.transformType = nameParse.type;
        this.transformAxis = nameParse.axis;

        if (type === Gizmo.HandleTypes.translate) {
          this.transformStart = this.params.getPosition().clone();
        }
        else if (type === Gizmo.HandleTypes.rotate) {
          this.transformStart = this.params.getRotation().clone();
        }
        else if (type === Gizmo.HandleTypes.scale) {
          this.transformStart = this.params.getScale().clone();
        }
      }
    },

    mouseup: function(pointer) {
      if (pointer.button !== 0) return;

      if (this.transformType === Gizmo.HandleTypes.translate) {
        if (this.params.onFinishTranslate) this.params.onFinishTranslate();
        // todo: others
      }

      this.transformType = Gizmo.HandleTypes.none;
      this.transformAxis = "";
      this.transformStart = null;

      if (this.params.onFinishTransform) this.params.onFinishTransform();
    },

    // with a transform currently active, handles the effect of a mouse move
    transformmove: function() {
      var type = this.transformType;
      var axis = this.transformAxis;

      // if rotate, handle an angle change
      if (type === Gizmo.HandleTypes.rotate) {
        var normal = this.transformDirection();
        var center = this.position;

        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);

        var intersection = this.raycaster.ray.intersectPlane(plane);
        if (intersection) {
          debug.cleanup();
          debug.oneline(center, intersection);
        }
      }
      // else, handle a shift along an axis
      else {
        // transform line parameters - point and direction
        var p0 = this.activePoint, d0 = this.transformDirection();

        // ray from the camera params
        var ray = this.raycaster.ray;
        var p1 = ray.origin, d1 = ray.direction;

        // calculate the point on the transform line that is closest to the view
        // ray:
        // v0 = p0 + t0d0, v1 = p1 + t1d1
        // t0 = ((d0 - d1 (d0 dot d1)) dot (p1 - p0)) / (1 - (d0 dot d1)^2)
        // t1 = ((d0 (d0 dot d1) - d1) dot (p1 - p0)) / (1 - (d0 dot d1)^2)
        var d0d1 = d0.dot(d1);
        var dn = 1 - d0d1 * d0d1;

        var t0 = d0.clone().addScaledVector(d1, -d0d1).dot(p1.clone().sub(p0)) / dn;
        var v0 = p0.clone().addScaledVector(d0, t0);

        var shift = v0.clone().sub(p0);

        if (type === Gizmo.HandleTypes.translate) {
          this.params.setPosition(this.transformStart.clone().add(shift));
          this.params.onTranslate();
          //this.position.addVectors(this.transformStart, shift);
        }
      }
    },

    transformDirection: function() {
      var axis = this.transformAxis;
      var v = new THREE.Vector3();

      if (axis === "o") v.subVectors(this.position, this.camera.position);
      else {
        var matrix = this.handleGroups[this.transformType].matrix;

        if (axis === "x") v.set(1, 0, 0);
        else if (axis === "y") v.set(0, 1, 0);
        else if (axis === "z") v.set(0, 0, 1);
        else return null;

        v.applyMatrix4(matrix);
      }

      return v;
    },

    activateHandle: function(handle) {
      var axis = parseHandleName(handle.name).axis;
      handle.material.color = this.colors[axis].active;
      handle.material.opacity = this.opacityActive;

      this.activeHandle = handle;
    },

    deactivateHandle: function() {
      var handle = this.activeHandle;
      if (handle === null) return;

      var axis = parseHandleName(handle.name).axis;

      handle.material.color = this.colors[axis].inactive;
      handle.material.opacity = this.opacityInactive;

      this.activeHandle = null;
      this.activePoint = null;
    },

    disableHandle: function(type, axis) {
      this.handles[type][axis].visible = false;
    },

    enableHandle: function(type, axis) {
      this.handles[type][axis].visible = true;
    }

  });

  return Gizmo;

})();
