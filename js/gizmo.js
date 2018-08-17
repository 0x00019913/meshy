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

  // clamp a number to two boundary values
  function clamp(x, minVal, maxVal) {
    if (x < minVal) x = minVal;
    else if (x > maxVal) x = maxVal;
    return x;
  }
  // compute acos, but clamp the input
  function acos(a) {
    return Math.acos(clamp(a, -1, 1));
  }

  function Gizmo(camera, domElement, params) {
    THREE.Object3D.call(this);

    this.camera = camera;
    this.up = camera.up.clone();
    this.domElement = domElement !== undefined ? domElement : document;

    this.visible = true; // todo: back to false

    // if some/all params are not provided, set defaults
    this.params = params || {};
    this.setDefaultParams();

    // color and material setup

    var activeFactor = 3;
    var al = 0.20; // axis color light
    var ad = 0.05; // axis color dark
    var oc = 0.20; // orthogonal handle color

    this.colors = {
      x: {}, y: {}, z: {}, o: {}
    };

    this.colors.x.inactive = new THREE.Color(al, ad, ad),
    this.colors.x.active = this.colors.x.inactive.clone().multiplyScalar(activeFactor);
    this.colors.x.disabled = new THREE.Color(ad, ad, ad);
    this.colors.y.inactive = new THREE.Color(ad, al, ad),
    this.colors.y.active = this.colors.y.inactive.clone().multiplyScalar(activeFactor);
    this.colors.y.disabled = new THREE.Color(ad, ad, ad);
    this.colors.z.inactive = new THREE.Color(ad, ad, al),
    this.colors.z.active = this.colors.z.inactive.clone().multiplyScalar(activeFactor);
    this.colors.z.disabled = new THREE.Color(ad, ad, ad);
    this.colors.o.inactive = new THREE.Color(oc, oc, oc),
    this.colors.o.active = this.colors.o.inactive.clone().multiplyScalar(activeFactor);
    this.colors.o.disabled = new THREE.Color(ad, ad, ad);

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

    this.ctrlKey = false;
    this.shiftKey = false;

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
      setProp("scaleOrthogonalHandleRadius", 3.0);
      setProp("scaleOrthogonalHandleWidthSegments", 32);
      setProp("scaleOrthogonalHandleHeightSegments", 16);

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
        if (axis === "o") {
          geo = new THREE.SphereBufferGeometry(
            this.params.scaleOrthogonalHandleRadius,
            this.params.scaleOrthogonalHandleWidthSegments,
            this.params.scaleOrthogonalHandleHeightSegments
          );
        }
        else {
          geo = new THREE.CylinderBufferGeometry(
            this.params.scaleHandleRadius,
            this.params.scaleHandleRadius,
            this.params.scaleHandleHeight,
            this.params.scaleHandleRadialSegments
          );
        }
      }
      else return;

      var handle = new THREE.Mesh(geo, material.clone());

      if (type === Gizmo.HandleTypes.translate) {
        handle.position[axis] = this.params.translateHandleOffset;
      }
      else if (type === Gizmo.HandleTypes.scale) {
        handle.position[axis] = this.params.scaleHandleOffset;
      }

      // point the mesh in the right direction
      if (axis === "x") handle.rotation.z = -Math.PI / 2;
      else if (axis === "z") handle.rotation.x = Math.PI / 2;

      // add the mesh to the appropriate handle group
      if (axis === "o") this.handleGroups.orthogonal.add(handle);
      else this.handleGroups[type].add(handle);

      // add the mesh to the handles collection
      this.handles[type][axis] = handle;
      handle.userData.enabled = true;

      // rotate the orthogonal handles' geometry to face up on the z axis so
      // that the lookat function works correctly
      if (axis === "o") {
        handle.rotation.x = Math.PI/2;
        handle.updateMatrix();
        handle.geometry.applyMatrix(handle.matrix);
        handle.rotation.x = 0;
        handle.updateMatrix();
      }

      handle.name = makeHandleName(axis, type);

      return handle;
    },

    makeHandles: function() {
      // translate handles

      // x translation
      this.makeHandle(Gizmo.HandleTypes.translate, "x", this.materials.x);
      // y translation
      this.makeHandle(Gizmo.HandleTypes.translate, "y", this.materials.y);
      // z translation
      this.makeHandle(Gizmo.HandleTypes.translate, "z", this.materials.z);

      // rotate handles

      // x rotation
      this.makeHandle(Gizmo.HandleTypes.rotate, "x", this.materials.x);
      // y rotation
      this.makeHandle(Gizmo.HandleTypes.rotate, "y", this.materials.y);
      // z rotation
      this.makeHandle(Gizmo.HandleTypes.rotate, "z", this.materials.z);
      // o rotation
      this.makeHandle(Gizmo.HandleTypes.rotate, "o", this.materials.o);

      // scale handles

      // x scale
      this.makeHandle(Gizmo.HandleTypes.scale, "x", this.materials.x);
      // y scale
      this.makeHandle(Gizmo.HandleTypes.scale, "y", this.materials.y);
      // z scale
      this.makeHandle(Gizmo.HandleTypes.scale, "z", this.materials.z);
      // o scale
      this.makeHandle(Gizmo.HandleTypes.scale, "o", this.materials.o);
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
        //this.handleGroups[Gizmo.HandleTypes.rotate].rotation.copy(rotation);
        this.handleGroups[Gizmo.HandleTypes.scale].rotation.copy(rotation);
      }
      // don't do anything for scale
    },

    mousemove: function(pointer) {
      this.raycaster.setFromCamera(pointer.coords, this.camera);
      this.ctrlKey = pointer.ctrlKey;
      this.shiftKey = pointer.shiftKey;

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
          var dist = Infinity;
          var handle = null;

          for (var i = 0; i < intersections.length; i++) {
            var intersection = intersections[i];
            var object = intersection.object;

            if (intersection.distance < dist && object.userData.enabled) {
              dist = intersection.distance;
              handle = object;
              this.activePoint = intersection.point;
            }
          }

          if (handle !== null) {
            if (this.activeHandle !== handle) this.deactivateHandle();
            this.activateHandle(handle);
          }
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

      this.transformFinish();
    },

    // with a transform currently active, handles the effect of a mouse move
    transformmove: function() {
      var type = this.transformType;
      var axis = this.transformAxis;

      // rotation transforms rely on the position of the cursor in a particular
      // plane, as do all orthogonal transforms
      var planeTransform = type === Gizmo.HandleTypes.rotate || axis === "o";

      // if plane transform, get the projected position of the cursor in the
      // transform plane
      if (planeTransform) {
        var normal = this.transformDirection();
        var center = this.position;

        var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);

        var cursor = this.raycaster.ray.intersectPlane(plane);
        if (cursor) {
          var d = cursor.clone().sub(center);

          var v0 = this.activePoint.clone().sub(center).normalize();
          var v1 = d.clone().normalize();

          // handle rotation, normal or orthogonal
          if (type === Gizmo.HandleTypes.rotate) {
            // calculate rotation angle
            var angle = Math.acos(v0.dot(v1));
            // CCW rotations are positive, CW rotations are negative
            angle *= Math.sign(v1.clone().cross(normal).dot(v0));

            // if ctrl is pressed, round the angle to 15 degrees
            var c = 180.0 / Math.PI;
            if (this.ctrlKey) angle = Math.round(angle * c / 15) * 15 / c;

            // get initial quaternion, rotate it by the angle, set euler from
            // the quaternion
            var euler = this.transformStart.clone();
            var q = new THREE.Quaternion().setFromEuler(euler);
            var dq = new THREE.Quaternion().setFromAxisAngle(normal, angle);
            euler.setFromQuaternion(q.premultiply(dq));

            this.params.setRotation(euler);
            this.params.onRotate();
          }
          else if (type === Gizmo.HandleTypes.scale) {
            var right = this.up.clone().cross(normal);
            var up = normal.clone().cross(right).normalize();

            var factor = Math.exp(d.dot(up) / this.params.scaleHandleOffset);
            var scale = this.transformStart.clone().multiplyScalar(factor);
            this.params.setScale(scale);
            this.params.onScale();
          }
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
        }
        else if (type === Gizmo.HandleTypes.scale) {
          var pos = this.params.getPosition();
          var factor = pos.distanceTo(v0) / pos.distanceTo(p0);
          var scale = this.transformStart.clone();
          scale[axis] *= factor;
          this.params.setScale(scale);
          this.params.onScale();
        }
      }
    },

    transformFinish: function() {
      if (this.transformType === Gizmo.HandleTypes.translate) {
        if (this.params.onFinishTranslate) this.params.onFinishTranslate();
      }
      else if (this.transformType === Gizmo.HandleTypes.scale) {
        if (this.params.onFinishScale) this.params.onFinishScale();
      }
      else if (this.transformType === Gizmo.HandleTypes.rotate) {
        if (this.params.onFinishRotate) this.params.onFinishRotate();
      }

      this.transformType = Gizmo.HandleTypes.none;
      this.transformAxis = "";
      this.transformStart = null;

      if (this.params.onFinishTransform) this.params.onFinishTransform();
    },

    transformDirection: function() {
      var axis = this.transformAxis;
      var v = new THREE.Vector3();

      if (axis === "o") v.subVectors(this.position, this.camera.position).normalize();
      else {

        if (axis === "x") v.set(1, 0, 0);
        else if (axis === "y") v.set(0, 1, 0);
        else if (axis === "z") v.set(0, 0, 1);
        else return null;

        if (this.transformType === Gizmo.HandleTypes.scale) {
          var matrix = this.handleGroups[this.transformType].matrix;
          v.applyMatrix4(matrix);
        }
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
      var handle = this.handles[type][axis];

      handle.userData.enabled = false;
      handle.material.color = this.colors[axis].disabled;
    },

    enableHandle: function(type, axis) {
      var handle = this.handles[type][axis];

      handle.userData.enabled = true;
      handle.material.color = this.colors[axis].inactive;
    }

  });

  return Gizmo;

})();
