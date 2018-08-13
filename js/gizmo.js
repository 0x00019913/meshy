var Gizmo = (function() {

  function Gizmo(camera, domElement, params) {
    THREE.Object3D.call(this);

    this.camera = camera;
    this.domElement = domElement !== undefined ? domElement : domElement;

    this.visible = true; // todo: back to false

    // if some/all params are not provided, set defaults
    this.params = params || {};
    this.setDefaultParams();

    this.materials = {
      x: new THREE.MeshStandardMaterial({
        color: 0xff8888,
        flatShading: true
      }),
      y: new THREE.MeshStandardMaterial({
        color: 0x88ff88,
        flatShading: true
      }),
      z: new THREE.MeshStandardMaterial({
        color: 0x8888ff,
        flatShading: true
      }),
    }

    // each group contains the handles of a particular type so that they can be
    // transformed together
    this.handleGroups = {};
    this.handleGroups.translate = new THREE.Group();
    this.handleGroups.rotate = new THREE.Group();
    this.handleGroups.scale = new THREE.Group();
    this.add(this.handleGroups.translate);
    this.add(this.handleGroups.rotate);
    this.add(this.handleGroups.scale);

    // individual handles
    this.handles = {};
    this.handles.translate = {};
    this.handles.rotate = {};
    this.handles.scale = {};

    this.makeHandles();
  }

  Gizmo.HandleTypes = {
    translate: "translate",
    rotate: "rotate",
    scale: "scale"
  };

  Gizmo.prototype = Object.create(THREE.Object3D.prototype);

  Object.assign(Gizmo.prototype, {

    constructor: Gizmo,

    setDefaultParams: function() {
      var params = this.params;

      if (!params.hasOwnProperty("coneRadius")) params.coneRadius = 1;
      if (!params.hasOwnProperty("coneHeight")) params.coneHeight = 1;
      if (!params.hasOwnProperty("coneRadialSegments")) params.coneRadialSegments = 8;
      if (!params.hasOwnProperty("translateHandleOffset")) params.translateHandleOffset = 15;

      if (!params.hasOwnProperty("pipeOuterRadius")) params.pipeOuterRadius = 10;
      if (!params.hasOwnProperty("pipeInnerRadius")) params.pipeInnerRadius = 9;
      if (!params.hasOwnProperty("pipeHeight")) params.pipeHeight = 1;
      if (!params.hasOwnProperty("pipeRadialSegments")) params.pipeRadialSegments = 8;

      if (!params.hasOwnProperty("cylinderRadius")) params.cylinderRadius = 1;
      if (!params.hasOwnProperty("cylinderHeight")) params.cylinderHeight = 1;
      if (!params.hasOwnProperty("cylinderRadialSegments")) params.cylinderRadialSegments = 8;
      if (!params.hasOwnProperty("scaleHandleOffset")) params.scaleHandleOffset = 10;
    },

    makeHandle: function(type, axis, material) {
      var geo;

      if (type === Gizmo.HandleTypes.translate) {
        geo = new THREE.ConeBufferGeometry(
          this.params.coneRadius,
          this.params.coneHeight,
          this.params.coneRadialSegments
        );
      }
      else if (type === Gizmo.HandleTypes.rotate) {
        geo = new PipeBufferGeometry(
          this.params.pipeOuterRadius,
          this.params.pipeInnerRadius,
          this.params.pipeHeight,
          this.params.pipeRadialSegments
        );
      }
      else if (type === Gizmo.HandleTypes.scale) {
        geo = new THREE.CylinderBufferGeometry(
          this.params.cylinderRadius,
          this.params.cylinderRadius,
          this.params.cylinderHeight,
          this.params.cylinderRadialSegments
        );
      }
      else return;

      var mesh = new THREE.Mesh(geo, material);

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
      this.handleGroups.translate.add(handle);
      this.handles.translate.x = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.translate, "y", this.materials.y);
      handle.position.y = this.params.translateHandleOffset;
      this.handleGroups.translate.add(handle);
      this.handles.translate.y = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.translate, "z", this.materials.z);
      handle.position.z = this.params.translateHandleOffset;
      this.handleGroups.translate.add(handle);
      this.handles.translate.z = handle;

      // rotate handles

      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "x", this.materials.x);
      this.handleGroups.rotate.add(handle);
      this.handles.rotate.x = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "y", this.materials.y);
      this.handleGroups.rotate.add(handle);
      this.handles.rotate.y = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.rotate, "z", this.materials.z);
      this.handleGroups.rotate.add(handle);
      this.handles.rotate.z = handle;

      // scale handles

      handle = this.makeHandle(Gizmo.HandleTypes.scale, "x", this.materials.x);
      handle.position.x = this.params.scaleHandleOffset;
      this.handleGroups.scale.add(handle);
      this.handles.scale.x = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.scale, "y", this.materials.y);
      handle.position.y = this.params.scaleHandleOffset;
      this.handleGroups.scale.add(handle);
      this.handles.scale.y = handle;

      handle = this.makeHandle(Gizmo.HandleTypes.scale, "z", this.materials.z);
      handle.position.z = this.params.scaleHandleOffset;
      this.handleGroups.scale.add(handle);
      this.handles.scale.z = handle;
    }

  });

  return Gizmo;

})();
