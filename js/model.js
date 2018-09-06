/* model.js
   classes:
    Model
   description:
    Represents a discrete model corresponding to one loaded OBJ or STL
    file. Has transformation functions, associated bounds that are
    recalculated on transformation, methods to do calculations, methods
    to import and export.
    Call .dispose() before leaving the instance to be cleaned up so that
    the geometry added to the scene can be properly deleted.
*/

/* Constructor - Initialize with a THREE.Scene, a THREE.Camera, an
   HTML element containing the viewport, a printout source (can be an
   instance of Printout, or console by default), and an output for
   measurements.
*/
function Model(geometry, scene, camera, container, printout) {
  this.scene = scene;
  this.camera = camera;
  this.container = container;
  this.printout = printout ? printout : console;

  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;
  //this.filename = "";
  this.setVertexPrecision(5);

  // calculated stuff
  this.boundingBox = new THREE.Box3();
  this.surfaceArea = null;
  this.volume = null;
  this.centerOfMass = null;
  // octree
  this.octree = null;

  // for display
  this.wireframe = false;
  this.wireframeMesh = null;
  this.generateMaterials();

  // instance of module responsible for slicing
  this.slicer = null;

  // current mode
  this.mode = "base";

  // meshes

  // base mesh
  this.baseMesh = null;
  geometry.mergeVertices();
  this.makeBaseMesh(geometry);

  // setup: clear colors, make bounding box, shift geometry to the mesh's
  // origin, set mode, and compute various quantities
  this.resetFaceColors();
  this.resetVertexColors();
  this.resetGeometryColors();
  this.computeBoundingBox();
  this.shiftBaseGeometryToOrigin();
  this.setMode("base");

  this.calculateSurfaceArea();
  this.calculateVolume();
  this.calculateCenterOfMass();

  // support mesh
  this.supportMesh = null;

  // slice meshes
  this.sliceOneLayerBaseMesh = null;
  this.sliceOneLayerContourMesh = null;
  this.sliceOneLayerInfillMesh = null;
  this.sliceAllContourMesh = null;
  this.slicePreviewSlicedMesh = null;
  this.slicePreviewGhostMesh = null;

  // three orthogonal planes that intersect at the center of the mesh
  this.centerOfMassIndicator = null;

  // for supports
  this.supportGenerator = null;
  this.supportsGenerated = false;
}

Model.prototype.generateMaterials = function() {
  this.materials = {
    base: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }),
    wireframe: new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true
    }),
    thicknessPreview: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: THREE.FaceColors,
      roughness: 0.3,
      metalness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }),
    sliceOneLayerBase: new THREE.LineBasicMaterial({
      color: 0x666666,
      linewidth: 1
    }),
    sliceOneLayerContour: new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1
    }),
    sliceOneLayerInfill: new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1
    }),
    sliceAllContours: new THREE.LineBasicMaterial({
      color: 0x666666,
      linewidth: 1
    }),
    slicePreviewMeshVisible: new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      color: 0x0f0f30,
      roughness: 0.8,
      metalness: 0.3,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }),
    slicePreviewMeshTransparent: new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0
    }),
    slicePreviewMeshGhost: new THREE.MeshStandardMaterial({
      color: 0x0f0f30,
      transparent: true,
      opacity: 0.3,
      roughness: 0.7,
      metalness: 0.3,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }),
    centerOfMassPlane: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    })
  };
}


// Bounding box functions.

// Compute the bounding box.
Model.prototype.computeBoundingBox = function() {
  this.boundingBox.setFromObject(this.baseMesh);
}
// All bounds to Infinity.
Model.prototype.resetBoundingBox = function() {
  this.boundingBox.makeEmpty();
}

Model.prototype.getMin = function() {
  return this.boundingBox.min;
}
Model.prototype.getMax = function() {
  return this.boundingBox.max;
}

// Get a vector representing the coords of the center.
Model.prototype.getCenter = function() {
  var center = new THREE.Vector3();
  this.boundingBox.getCenter(center);
  return center;
}
// Get a vector representing the size of the model in every direction.
Model.prototype.getSize = function() {
  var size = new THREE.Vector3();
  this.boundingBox.getSize(size);
  return size;
}
// Largest dimension of the model.
Model.prototype.getMaxSize = function() {
  var size = this.getSize();
  return Math.max(size.x, size.y, size.z);
}
// Smallest dimension of the model.
Model.prototype.getMinSize = function() {
  var size = this.getSize();
  return Math.min(size.x, size.y, size.z);
}

Model.prototype.getXRange = function() {
  return new THREE.Vector2(this.boundingBox.min.x, this.boundingBox.max.x);
}
Model.prototype.getYRange = function() {
  return new THREE.Vector2(this.boundingBox.min.y, this.boundingBox.max.y);
}
Model.prototype.getZRange = function() {
  return new THREE.Vector2(this.boundingBox.min.z, this.boundingBox.max.z);
}

Model.prototype.getPolyCount = function() {
  return this.baseMesh.geometry.faces.length;
}

Model.prototype.getVertexCount = function() {
  return this.baseMesh.geometry.vertices.length;
}

Model.prototype.getPosition = function() {
  return this.baseMesh.position;
}
Model.prototype.getRotation = function() {
  return this.baseMesh.rotation;
}
Model.prototype.getScale = function() {
  return this.baseMesh.scale;
}
Model.prototype.getMesh = function() {
  return this.baseMesh;
}

// todo: possibly deprecate?
// set the precision factor used to merge geometries
Model.prototype.setVertexPrecision = function(precision) {
  this.vertexPrecision = precision;
  this.p = Math.pow(10, precision);
}

/* RAYCASTING */

// pass straight through to the base mesh to raycast;
// todo: route through an octree instead for efficiency
Model.prototype.raycast = function(raycaster, intersects) {
  this.baseMesh.raycast(raycaster, intersects);
}

/* TRANSFORMATIONS */

// want rotations and scalings to occur with respect to the geometry center
Model.prototype.shiftBaseGeometryToOrigin = function() {
  var mesh = this.baseMesh;
  var center = this.getCenter();
  var shift = mesh.position.clone().sub(center);

  // shift geometry center to origin
  mesh.position.copy(center.negate());
  mesh.updateMatrixWorld();
  mesh.geometry.applyMatrix(mesh.matrixWorld);

  // reset mesh position to 0
  mesh.position.set(0, 0, 0);
  mesh.updateMatrixWorld();

  // shift bounds appropriately
  this.boundingBox.translate(shift);
}

Model.prototype.translate = function(position) {
  var diff = position.clone().sub(this.baseMesh.position);

  this.baseMesh.position.copy(position);
  if (this.supportMesh) this.supportMesh.position.copy(position);
  if (this.wireframeMesh) this.wireframeMesh.position.copy(position);
  this.baseMesh.updateMatrixWorld();

  this.boundingBox.translate(diff);

  if (this.centerOfMass) {
    this.centerOfMass.add(diff);
    // transform center of mass indicator
    this.positionCenterOfMassIndicator();
  }
}
Model.prototype.translateEnd = function() {
  // no-op
}

Model.prototype.rotate = function(euler) {
  this.baseMesh.rotation.copy(euler);
  if (this.wireframeMesh) this.wireframeMesh.rotation.copy(euler);
  this.baseMesh.updateMatrixWorld();
}
Model.prototype.rotateEnd = function() {
  this.computeBoundingBox();
  this.positionCenterOfMassIndicator();
}

Model.prototype.scale = function(scale) {
  this.baseMesh.scale.copy(scale);
  if (this.wireframeMesh) this.wireframeMesh.scale.copy(scale);
  this.baseMesh.updateMatrixWorld();
}
Model.prototype.scaleEnd = function() {
  this.clearThicknessView();
  this.computeBoundingBox();
  this.calculateVolume();
  this.calculateSurfaceArea();
  this.positionCenterOfMassIndicator();
}

// mirror the geometry on an axis
// NB: assumes that the geometry is centered on 0
Model.prototype.mirror = function(axis) {
  var scale = new THREE.Vector3(1, 1, 1);
  scale[axis] = -1;
  var geo = this.baseMesh.geometry;

  // reflect each vertex across 0
  for (var v = 0; v < geo.vertices.length; v++) {
    geo.vertices[v].multiply(scale);
  }

  for (var f = 0; f < geo.faces.length; f++) {
    var face = geo.faces[f];

    // flip winding order on each face
    var tmp = face.a;
    face.a = face.b;
    face.b = tmp;

    // flip face normal on the axis
    face.normal.multiply(scale);

    // also flip vertex normals if present
    if (face.vertexNormals) {
      for (var n = 0; n < face.vertexNormals.length; n++) {
        face.vertexNormals[n].multiply(scale);
      }
    }
  }

  geo.verticesNeedUpdate = true;
  geo.elementsNeedUpdate = true;
}

Model.prototype.flipNormals = function() {
  var geo = this.baseMesh.geometry;

  for (var f = 0; f < geo.faces.length; f++) {
    var face = geo.faces[f];

    // flip winding order on each face
    var tmp = face.a;
    face.a = face.b;
    face.b = tmp;

    // flip face normal
    face.normal.negate();

    // also flip vertex normals if present
    if (face.vertexNormals) {
      for (var n = 0; n < face.vertexNormals.length; n++) {
        face.vertexNormals[n].negate();
      }
    }
  }

  geo.elementsNeedUpdate = true;
  geo.normalsNeedUpdate = true;
}



/* CALCULATIONS */

// Calculate surface area.
Model.prototype.calculateSurfaceArea = function() {
  this.surfaceArea = Calculate.surfaceArea(this.baseMesh);
}

// Calculate volume.
Model.prototype.calculateVolume = function() {
  this.volume = Calculate.volume(this.baseMesh);
}

// Calculate center of mass.
Model.prototype.calculateCenterOfMass = function() {
  this.centerOfMass = Calculate.centerOfMass(this.baseMesh);
}

// Calculate cross-section.
Model.prototype.calcCrossSection = function(axis, pos) {
  var axisVector = new THREE.Vector3();
  axisVector[axis] = 1;
  var point = axisVector.clone();
  point[axis] = pos;
  var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisVector, point);

  return Calculate.crossSection(plane, this.baseMesh);
}



/* UI AND RENDERING */

// Toggle wireframe.
Model.prototype.toggleWireframe = function() {
  this.wireframe = !this.wireframe;
  this.setWireframeVisibility(this.wireframe);
}
Model.prototype.setWireframeVisibility = function(visible) {
  if (this.wireframeMesh === null) this.makeWireframeMesh();

  this.printout.log("Wireframe is " + (visible ? "on" : "off") + ".");

  this.wireframeMesh.visible = visible;
}

Model.prototype.makeWireframeMesh = function() {
  var mesh = this.baseMesh.clone();

  mesh.material = this.materials.wireframe;
  mesh.visible = false;
  mesh.name = "wireframe";
  this.scene.add(mesh);

  this.wireframeMesh = mesh;
}

// Get and set material color.
Model.prototype.getMeshColor = function() {
  if (this.baseMesh) return this.baseMesh.material.color.getHex();
}
Model.prototype.setMeshMaterial = function(color, roughness, metalness) {
  var mat = this.materials.base;

  mat.color.set(color);
  mat.roughness = roughness;
  mat.metalness = metalness;
}
Model.prototype.setWireframeMaterial = function(color) {
  var mat = this.materials.wireframe;

  mat.color.set(color);
}

// Toggle the COM indicator. If the COM hasn't been calculated, then
// calculate it.
Model.prototype.toggleCenterOfMass = function() {
  if (this.centerOfMass === null) this.calculateCenterOfMass();

  this.centerOfMassIndicator.visible = !this.centerOfMassIndicator.visible;
  this.printout.log(
    "Center of mass indicator is "+(this.centerOfMassIndicator.visible ? "on" : "off")+"."
  );
  this.positionCenterOfMassIndicator();
}

// Create the target planes forming the COM indicator.
Model.prototype.generateCenterOfMassIndicator = function() {
  var centerOfMassIndicator = new THREE.Object3D;

  centerOfMassIndicator.name = "centerOfMassIndicator";
  centerOfMassIndicator.visible = false;

  var xgeo = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2); // normal x
  var ygeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2); // normal y
  var zgeo = new THREE.PlaneGeometry(1, 1); // normal z

  var planeMat = this.materials.centerOfMassPlane;

  centerOfMassIndicator.add(
    new THREE.Mesh(xgeo, planeMat),
    new THREE.Mesh(ygeo, planeMat),
    new THREE.Mesh(zgeo, planeMat)
  );

  this.centerOfMassIndicator = centerOfMassIndicator;

  this.scene.add(centerOfMassIndicator);
}

// Position the COM indicator.
Model.prototype.positionCenterOfMassIndicator = function() {
  if (!this.centerOfMassIndicator) this.generateCenterOfMassIndicator();

  var size = this.getSize();

  // position the planes within the indicator object
  var indicator = this.centerOfMassIndicator;
  var planes = indicator.children;
  var pos = this.centerOfMass.clone().sub(this.boundingBox.min).divide(size).subScalar(0.5);

  planes[0].position.x = pos.x;
  planes[1].position.y = pos.y;
  planes[2].position.z = pos.z;

  // position and scale the indicator
  var extendFactor = 0.1;
  var scale = size.clone().multiplyScalar(1.0 + extendFactor);

  this.centerOfMassIndicator.scale.copy(scale);
  this.centerOfMassIndicator.position.copy(this.getCenter());
}

// Set the mode.
Model.prototype.setMode = function(mode, params) {
  this.mode = mode;
  // remove any current meshes in the scene
  removeMeshByName(this.scene, "base");
  removeMeshByName(this.scene, "support");
  removeMeshByName(this.scene, "slice");

  // base mode - display the normal, plain mesh
  if (mode == "base") {
    this.scene.add(this.baseMesh);
    if (this.supportsGenerated) {
      this.makeSupportMesh();
      this.scene.add(this.supportMesh);
    }
  }
  // slicing mode - init slicer and display a model in preview mode by default
  else if (mode == "slice") {
    this.slicer = new Slicer([this.baseMesh, this.supportMesh], params);

    this.makeSliceMeshes();
    this.addSliceMeshesToScene();
  }
}

// Create the base mesh (as opposed to another display mode).
// todo: remove
Model.prototype.makeBaseMesh = function(geo) {
  if (!this.baseMesh) {
    //var geo = new THREE.Geometry();
    this.baseMesh = new THREE.Mesh(geo, this.materials.base);
    this.baseMesh.name = "base";
  }

  return this.baseMesh;
}
Model.prototype.makeSupportMesh = function() {
  if (!this.supportMesh) {
    var geo = new THREE.Geometry();
    this.supportMesh = new THREE.Mesh(geo, this.materials.base);
    this.supportMesh.name = "support";
  }

  return this.supportMesh;
}

Model.prototype.addSliceMeshesToScene = function() {
  if (!this.slicer) return;

  removeMeshByName(this.scene, "slice");

  // add meshes for current layer contours and infill, unless mode is full and
  // showing all layers at once
  if (this.slicer.mode !== Slicer.Modes.full || this.slicer.fullUpToLayer) {
    this.scene.add(this.sliceOneLayerBaseMesh);
    this.scene.add(this.sliceOneLayerContourMesh);
    this.scene.add(this.sliceOneLayerInfillMesh);
  }

  // if preview, either add sliced mesh or ghost mesh
  if (this.slicer.mode === Slicer.Modes.preview) {
    if (this.slicer.previewSliceMesh) this.scene.add(this.slicePreviewSlicedMesh);
    else this.scene.add(this.slicePreviewGhostMesh);
  }
  // else, if full, add all-contour mesh
  else if (this.slicer.mode === Slicer.Modes.full) {
    this.scene.add(this.sliceAllContourMesh);
  }
}

// mark slice meshes in the scene as needing update
Model.prototype.updateSliceMeshesInScene = function() {
  if (!this.slicer) return;

  var geos = this.slicer.getGeometry();

  if (!this.slicer.mode !== Slicer.Modes.full || this.slicer.fullUpToLayer) {
    var oneLayerBaseGeo = new THREE.Geometry();
    oneLayerBaseGeo.vertices = geos.currentLayerBase.geo.vertices;
    this.sliceOneLayerBaseMesh.geometry = oneLayerBaseGeo;

    var oneLayerContourGeo = new THREE.Geometry();
    oneLayerContourGeo.vertices = geos.currentLayerContours.geo.vertices;
    this.sliceOneLayerContourMesh.geometry = oneLayerContourGeo;

    var oneLayerInfillGeo = new THREE.Geometry();
    oneLayerInfillGeo.vertices = geos.currentLayerInfill.geo.vertices;
    this.sliceOneLayerInfillMesh.geometry = oneLayerInfillGeo;
  }

  if (this.slicer.mode === Slicer.Modes.preview) {
    if (this.slicer.previewSliceMesh) {
      var slicedMeshGeo = new THREE.Geometry();
      slicedMeshGeo.vertices = geos.slicedMesh.geo.vertices;
      slicedMeshGeo.faces = geos.slicedMesh.geo.faces;
      this.slicePreviewSlicedMesh.geometry = slicedMeshGeo;

      this.slicePreviewSlicedMesh.geometry.verticesNeedUpdate = true;
      this.slicePreviewSlicedMesh.geometry.elementsNeedUpdate = true;
    }
  }
  else if (this.slicer.mode === Slicer.Modes.full) {
    var allContourGeo = new THREE.Geometry();
    allContourGeo.vertices = geos.allContours.geo.vertices;
    this.sliceAllContourMesh.geometry = allContourGeo;
  }
}

// make display meshes for slice mode
Model.prototype.makeSliceMeshes = function() {
  if (!this.slicer) return;

  var geos = this.slicer.getGeometry();
  var mesh;

  // make mesh for current layer's base contour
  mesh = new THREE.LineSegments(
    geos.currentLayerBase.geo,
    this.materials.sliceOneLayerBase
  );
  mesh.name = "slice";
  this.sliceOneLayerBaseMesh = mesh;

  // make mesh for current layer's print contours
  mesh = new THREE.LineSegments(
    geos.currentLayerContours.geo,
    this.materials.sliceOneLayerContour
  );
  mesh.name = "slice";
  this.sliceOneLayerContourMesh = mesh;

  // make mesh for current layer's infill
  mesh = new THREE.LineSegments(
    geos.currentLayerInfill.geo,
    this.materials.sliceOneLayerInfill
  );
  mesh.name = "slice";
  this.sliceOneLayerInfillMesh = mesh;

  // make mesh for all non-current layer contours
  mesh = new THREE.LineSegments(
    geos.allContours.geo,
    this.materials.sliceAllContours
  );
  mesh.name = "slice";
  this.sliceAllContourMesh = mesh;

  // make mesh for sliced geometry - supports two material indices for making
  // faces visible and invisible
  mesh = new THREE.Mesh(
    geos.slicedMesh.geo,
    [this.materials.slicePreviewMeshVisible, this.materials.slicePreviewMeshTransparent]
  );
  mesh.name = "slice";
  this.slicePreviewSlicedMesh = mesh;

  // to make the ghost, just clone the base mesh and assign ghost material
  mesh = new THREE.Mesh(geos.source.geo, this.materials.slicePreviewMeshGhost);
  mesh.name = "slice";
  this.slicePreviewGhostMesh = mesh;
}



// get the octree, build it if necessary
Model.prototype.getOctree = function() {
  if (this.octree === null) this.octree = new Octree(this.baseMesh);

  return this.octree;
}


/* MESH THICKNESS */

// color the verts according to their local diameter
Model.prototype.viewThickness = function(threshold) {
  var octree = this.getOctree();

  // set the material
  this.baseMesh.material = this.materials.thicknessPreview;

  // make sure the world matrix is up to date
  this.baseMesh.updateMatrixWorld();

  var geo = this.baseMesh.geometry;
  var vertices = geo.vertices;
  var faces = geo.faces;
  var matrixWorld = this.baseMesh.matrixWorld;

  var ray = new THREE.Ray();
  var normal = new THREE.Vector3();
  var pointWorld = new THREE.Vector3();

  this.resetFaceColors();

  for (var f = 0, l = faces.length; f < l; f++) {
    var face = faces[f];

    // compute ray in world space
    ray.origin = Calculate.faceCenter(face, vertices, matrixWorld);
    ray.direction = normal.copy(face.normal).transformDirection(matrixWorld).normalize().negate();

    var intersection = octree.raycastInternal(ray);

    if (intersection) {
      pointWorld.copy(intersection.point).applyMatrix4(matrixWorld);

      var dist = pointWorld.distanceTo(ray.origin);
      var level = Math.min(dist/threshold, 1.0);

      face.color.setRGB(1.0, level, level);
    }
  }

  geo.colorsNeedUpdate = true;
}

// clear any coloration that occurred as part of thickness visualization
Model.prototype.clearThicknessView = function() {
  this.baseMesh.material = this.materials.base;

  //this.resetFaceColors();
}

// reset face colors to white
Model.prototype.resetFaceColors = function() {
  var faces = this.baseMesh.geometry.faces;
  for (var f = 0; f < faces.length; f++) {
    faces[f].color.setRGB(1.0, 1.0, 1.0);
  }

  this.baseMesh.geometry.colorsNeedUpdate = true;
}

// reset vertex colors to white
Model.prototype.resetVertexColors = function() {
  var faces = this.baseMesh.geometry.faces;
  for (var f = 0; f < faces.length; f++) {
    var vertexColors = faces[f].vertexColors;

    if (vertexColors) vertexColors.length = 0;
  }

  this.baseMesh.geometry.colorsNeedUpdate = true;
}

Model.prototype.resetGeometryColors = function() {
  this.baseMesh.geometry.colors.length = 0;
  this.baseMesh.geometry.colorsNeedUpdate = true;
}


/* MESH REPAIR */

Model.prototype.repair = function() {
  var patchGeo = Repair.generatePatchGeometry(this.baseMesh);

  if (!patchGeo) {
    this.printout.log("Mesh does not require repair.");
    return;
  }

  var geo = this.baseMesh.geometry;

  geo.merge(patchGeo);
  geo.mergeVertices();
  geo.verticesNeedUpdate = true;
  geo.elementsNeedUpdate = true;
}


/* SUPPORTS */

Model.prototype.generateSupports = function(params) {
  this.removeSupports();

  if (!this.supportGenerator) {
    this.supportGenerator = new SupportGenerator(this.baseMesh);
  }

  // add mesh min and max to the params and pass them to the support generator
  Object.assign(params, {
    min: this.boundingBox.min,
    max: this.boundingBox.max
  });

  var supportMesh = this.makeSupportMesh();
  supportMesh.geometry = this.supportGenerator.generate(params);
  this.scene.add(supportMesh);
  this.supportsGenerated = true;
}

Model.prototype.removeSupports = function() {
  if (this.supportGenerator) this.supportGenerator.cleanup();

  this.supportsGenerated = false;
  this.supportMesh = null;
  removeMeshByName(this.scene, "support");
}


/* SLICING */

// Turn on slice mode: set mode to "slice", passing various params. Slice mode
// defaults to preview.
Model.prototype.startSliceMode = function(params) {
  this.setWireframeVisibility(false);

  this.setMode("slice", params);
}

// Turn off slice mode: set mode to "base".
Model.prototype.endSliceMode = function() {
  if (this.slicer === null) return;

  this.setMode("base");
  this.slicer = null;
  this.sliceFullMesh = null;
}

Model.prototype.getMaxLevel = function() {
  if (this.slicer) return this.slicer.getMaxLevel();
  else return 0;
}

Model.prototype.getMinLevel = function() {
  if (this.slicer) return this.slicer.getMinLevel();
  else return 0;
}

Model.prototype.getCurrentSliceLevel = function() {
  if (this.slicer) return this.slicer.getCurrentLevel();
  else return 0;
}

Model.prototype.getSliceMode = function() {
  if (this.slicer) return this.slicer.getMode();
  else return null;
}

Model.prototype.setSliceMode = function(sliceMode) {
  if (this.slicer.mode == sliceMode || !this.slicer) return;

  //removeMeshByName(this.scene, "model");

  this.slicer.setMode(sliceMode);

  this.addSliceMeshesToScene();
  this.updateSliceMeshesInScene();
}

Model.prototype.setSliceLevel = function(level) {
  if (!this.slicer) return;

  this.slicer.setLevel(level);

  this.updateSliceMeshesInScene();
}

Model.prototype.updateSlicerParams = function(params) {
  if (!this.slicer) return;

  var updated = this.slicer.updateParams(params);
  this.setSliceLevel();

  this.addSliceMeshesToScene();
}

Model.prototype.gcodeSave = function(params) {
  if (!this.slicer) return;

  this.slicer.gcodeSave(params);
}


/* IMPORT AND EXPORT */

// Generate file output representing the model and save it.
/*Model.prototype.export = function(format, name) {
  var isLittleEndian = this.isLittleEndian;
  var blob;
  var fname;
  var geo = this.baseMesh.geometry;

  var count = geo.faces.length;
  var vertices = geo.vertices;
  var faces = geo.faces;

  if (format=="stl") {
    var stlSize = 84 + 50 * count;
    var array = new ArrayBuffer(stlSize);
    var offset = 0;
    var dv = new DataView(array);
    // I can't figure out a better way of transferring the header bytes to the
    // new array than by using the DataView API and copying them one by one
    if (!this.header) this.header = new ArrayBuffer(80);
    var dvHeader = new DataView(this.header);
    for (offset=0; offset<80; offset++) {
      var ch = dvHeader.getUint8(offset);
      dv.setUint8(offset, ch);
    }

    dv.setUint32(offset, count, isLittleEndian);
    offset += 4;
    for (var tri=0; tri<count; tri++) {
      var face = faces[tri];

      setVector3(dv, offset, face.normal, isLittleEndian);
      offset += 12;

      for (var vert=0; vert<3; vert++) {
        setVector3(dv, offset, vertices[face[faceGetSubscript(vert)]], isLittleEndian);
        offset += 12;
      }

      // the "attribute byte count" should be set to 0 according to
      // https://en.wikipedia.org/wiki/STL_(file_format)
      dv.setUint8(offset, 0);
      dv.setUint8(offset+1, 0);

      offset += 2;
    }

    function setVector3(dv, offset, vector, isLittleEndian) {
      dv.setFloat32(offset, vector.x, isLittleEndian);
      dv.setFloat32(offset+4, vector.y, isLittleEndian);
      dv.setFloat32(offset+8, vector.z, isLittleEndian);
    }

    blob = new Blob([dv]);
    fname = name+".stl";
  }
  else if (format=="stlascii") {
    var indent2 = "  ", indent4 = "    ", indent6 = "      ";
    var out = "";

    out =  "solid " + name + '\n';
    for (var tri=0; tri<count; tri++) {
      var faceOut = "";
      var face = faces[tri];
      faceOut += indent2 + "facet normal" + writeVector3(face.normal) + '\n';
      faceOut += indent4 + "outer loop" + '\n';
      for (var vert=0; vert<3; vert++) {
        var v = vertices[face[faceGetSubscript(vert)]];
        faceOut += indent6 + "vertex" + writeVector3(v) + '\n';
      }
      faceOut += indent4 + "endloop" + '\n';
      faceOut += indent2 + "endfacet" + '\n';

      out += faceOut;
    }
    out += "endsolid";

    function writeVector3(v) {
      line = "";
      for (var i=0; i<3; i++) line += " " + v.getComponent(i).toFixed(6);
      return line;
    }

    blob = new Blob([out], { type: 'text/plain' });
    fname = name+".stl";
  }
  else if (format=="obj") {
    var out = "";

    out =  "# OBJ exported from Meshy, 0x00019913.github.io/meshy \n";
    out += "# NB: this file only stores faces and vertex positions. \n";
    out += "# number vertices: " + vertices.length + "\n";
    out += "# number triangles: " + faces.length + "\n";
    out += "#\n";
    out += "# vertices: \n";

    // write the list of vertices
    for (var vert=0; vert<vertices.length; vert++) {
      var line = "v";
      var vertex = vertices[vert];
      for (var comp=0; comp<3; comp++) line += " " + vertex.getComponent(comp).toFixed(6);
      line += "\n";
      out += line;
    }

    out += "# faces: \n";
    for (var tri=0; tri<count; tri++) {
      var line = "f";
      var face = faces[tri];
      for (var vert=0; vert<3; vert++) {
        line += " " + (face[faceGetSubscript(vert)]+1);
      }
      line += "\n";
      out += line;
    }

    blob = new Blob([out], { type: 'text/plain' });
    fname = name+".obj";
  }
  else {
    this.printout.error("Exporting format '"+format+"' is not supported.");
    return;
  }

  var a = document.createElement("a");
  if (window.navigator.msSaveOrOpenBlob) { // IE :(
    window.navigator.msSaveOrOpenBlob(blob, fname);
  }
  else {
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    });
  }
  this.printout.log("Saved file '" + fname + "' as " + format.toUpperCase());
}*/

// TODO: either split importers into separate files and replace THREE loaders
// with these, or just deprecate

// Import a model from an STL or OBJ file (any capitalization).
/*Model.prototype.import = function(file, params, callback) {
  params = params || {};
  var unitsFrom = params.hasOwnProperty("unitsFrom") ? params.unitsFrom : Units.mm;
  var unitsTo = params.hasOwnProperty("unitsTo") ? params.unitsTo : Units.mm;
  var convertUnits = Units.getConverterV3(unitsFrom, unitsTo);

  var fSplit = splitFilename(file.name);
  this.filename = fSplit.name;
  this.format = fSplit.extension;

  var _this = this;

  fr = new FileReader();
  fr.onload = function() {
    var success = false;
    try {
      parseResult(fr.result);
      success = true;

      // set mode to base mesh, which creates the mesh and puts it in the scene
      _this.setMode("base");
      _this.printout.log("Imported file: " + file.name);
    } catch(e) {
      _this.printout.error("Error importing: " + e);
    }
    callback(success, _this);
  };

  if (this.format=="stl") {
    // check STL type (read it once and run the necessary checks) - if binary
    // (not ascii), read as array; if ascii, read as text

    // make a secondary FileReader
    var fr1 = new FileReader();
    // the .onload will either load geometry as text or as array
    fr1.onload = function() {
      if (isBinary(fr1.result)) fr.readAsArrayBuffer(file);
      else {
        _this.format = "stlascii";
        fr.readAsText(file);
      }
    }
    // start up the secondary FileReader
    fr1.readAsArrayBuffer(file);

    // returns true if binary; else, return false
    function isBinary(result) {
      var dv = new DataView(result, 0);
      // an ascii STL file will begin with these characters
      var solid = "solid ";
      var isBinary = false;

      // number of triangles if binary
      var n = dv.getUint32(80, _this.isLittleEndian);

      // file must be 84 + n*50 bytes long if binary
      if (dv.byteLength === 84 + n*50) return true;

      // check that the file begins with the string "solid "
      for (var i=0; i<solid.length; i++) {
        if (String.fromCharCode(dv.getUint8(i)) != solid[i]) {
          isBinary = true;
          break;
        }
      }

      return isBinary;
    }
  }
  // if OBJ, read as ascii characters
  else if (this.format=="obj") {
    fr.readAsText(file);
  }
  // else, we don't support this format
  else {
    var error = "Format '"+this.format+"' is not supported.";
    this.printout.error(error);
    callback(false, this);
    return;
  }

  function parseResult(result) {
    var geo = new THREE.Geometry();
    var vertices = geo.vertices;
    var faces = geo.faces;

    // if binary STL
    if (_this.format=="stl") {
      // mimicking
      // http://tonylukasavage.com/blog/2013/04/10/web-based-stl-viewing-three-dot-js/
      _this.header = result.slice(0, 80); // store STL header

      var dv = new DataView(result, 80);
      var isLittleEndian = _this.isLittleEndian;

      var n = dv.getUint32(0, isLittleEndian);

      offset = 4;
      // for building a unique set of vertices; contains a set of (vertex, idx) pairs;
      // mimics the code found in the THREE.Geometry class
      var vertexMap = {};
      var p = Math.pow(10, _this.vertexPrecision);

      for (var tri=0; tri<n; tri++) {
        var face = new THREE.Face3();

        offset += 12;

        for (var vert=0; vert<3; vert++) {
          var vertex = convertUnits(getVector3(dv, offset, isLittleEndian));
          var key = vertexHash(vertex, p);
          var idx = -1;
          if (vertexMap[key]===undefined) {
            idx = vertices.length;
            vertexMap[key] = idx;
            vertices.push(vertex);
          }
          else {
            idx = vertexMap[key];
          }
          face[faceGetSubscript(vert)] = idx;
          offset += 12;
        }

        faceComputeNormal(face, vertices);

        // ignore "attribute byte count" (2 bytes)
        offset += 2;
        faces.push(face);
      }

      function getVector3(dv, offset, isLittleEndian) {
        return new THREE.Vector3(
          dv.getFloat32(offset, isLittleEndian),
          dv.getFloat32(offset+4, isLittleEndian),
          dv.getFloat32(offset+8, isLittleEndian)
        );
      }
    }
    // if ascii STL
    else if (_this.format=="stlascii") {
      var len = result.length;
      // position in the file
      var i = 0;
      var lineNum = 0;

      // for building a unique set of vertices; contains a set of (vertex, idx) pairs;
      // mimics the code found in the THREE.Geometry class
      var vertexMap = {};
      var p = Math.pow(10, _this.vertexPrecision);

      // read the characters of the file
      while (i<len) {
        var line = getLine();
        if (line.startsWith("facet normal ")) {
          var face = new THREE.Face3();
          // get the face normal from the line
          face.normal = getVector3(line.substring(13)).normalize();

          getLine(); // clear the "outer loop" line

          var numVerts = 0;
          // read off the three vertices
          for (var vert=0; vert<3; vert++) {
            var vline = getLine();
            // if the line doesn't begin with "vertex ", break
            if (!vline.startsWith("vertex ")) break;

            var vertex = convertUnits(getVector3(vline.substring(7)));
            var idx = vertexMapIdx(vertexMap, vertex, vertices, p);

            face[faceGetSubscript(vert)] = idx;
            numVerts++;
          }

          if (numVerts!=3) {
            throw "incorrect number of vertices at line "+lineNum+" of '"+file.name+"'";
          }

          getLine(); // clear the "endloop" line
          getLine(); // clear the "endfacet" line
          faces.push(face);
        }
      }

      function getLine() {
        var i0 = i, ri;
        do {
          ri = result[i];
          i++;
        } while (ri!='\n' && i<len);
        lineNum++;
        return result.substring(i0, i).trim();
      }
      function getVector3(s) {
        var vector = new THREE.Vector3();
        //split on whitespace
        var split = s.split(/\s+/);
        // read off three numbers
        var j = 0;
        for (var k=0; k<split.length; k++) {
          var sk = split[k];
          if (sk.length > 0) vector.setComponent(j++, parseFloat(sk));
        }
        return vector;
      }
    }
    // if OBJ
    else if (_this.format=="obj") {
      var len = result.length;
      var hasVertNormals = false;
      var vertexNormals = [];
      var i = 0;
      var lineNum = 0;

      while (i<len) {
        // get a line from the file string
        var line = getLine();
        if (line.length==0) continue;
        // if vertex, get vertex; relevant flags are 'v' and 'vn'
        if (line[0]=='v') {
          if (line[1]==' ') {
            var vertex = convertUnits(getVector3(line.substring(2)));
            vertices.push(vertex);
          }
          else if (line[1]=='n') {
            var normal = getVector3(line.substring(3)).normalize();
            vertexNormals.push(normal);
          }
        }
        // if face, get face
        else if (line[0]=='f') {
          hasVertNormals = (vertices.length==vertexNormals.length);
          var triangles = getTriangles(line.substring(2));
          for (var tri=0; tri<triangles.length; tri++) faces.push(triangles[tri]);
        }
      }

      function getLine() {
        var i0 = i, ri;
        do {
          ri = result[i];
          i++;
        } while (ri!='\n' && i<len);
        lineNum++;
        return result.substring(i0, i).trim();
      }
      function getVector3(s) {
        var vector = new THREE.Vector3();
        var split = s.split(' ');
        // read off three numbers
        for (var j=0; j<3; j++) vector.setComponent(j, parseFloat(split[j]));
        return vector;
      }
      function getTriangles(s) {
        var triangles = [];
        // array of 3-element arrays indicating the vertex indices for each tri
        var triIndices = [];

        // split line of vertex indices, trim off any '/'-delimited UVs/normals
        var polyIndices = s.split(' ');
        polyIndices = polyIndices.map(function(st) {
          var slashIdx = st.indexOf('/');
          return slashIdx==-1 ? (st-1) : (st.substr(0, slashIdx))-1;
        });

        // if the face is a tri, just one set of 3 indices
        if (polyIndices.length==3) {
          triIndices.push(polyIndices);
        }
        // if a quad, need to triangulate - pick closest corners to make new edge
        else if (polyIndices.length==4) {
          var v = new THREE.Vector3();
          var d02 = v.subVectors(
            vertices[polyIndices[0]],
            vertices[polyIndices[2]]
          ).length();
          var d13 = v.subVectors(
            vertices[polyIndices[1]],
            vertices[polyIndices[3]]
          ).length();
          if (d02<d13) {
            triIndices.push([polyIndices[0],polyIndices[1],polyIndices[2]]);
            triIndices.push([polyIndices[0],polyIndices[2],polyIndices[3]]);
          }
          else {
            triIndices.push([polyIndices[0],polyIndices[1],polyIndices[3]]);
            triIndices.push([polyIndices[3],polyIndices[1],polyIndices[2]]);
          }
        }
        else if (polyIndices.length<3) {
          throw "not enough face indices at line "+lineNum+" of '"+file.name+"'";
        }
        for (var tri=0; tri<triIndices.length; tri++) {
          var triangle = new THREE.Face3();
          triangles.push(triangle);
          for (var j=0; j<3; j++) {
            triangle[faceGetSubscript(j)] = triIndices[tri][j];
          }

          // average vertex normals (if available) or calculate via x-product
          var normal = new THREE.Vector3();
          if (hasVertNormals) {
            for (var j=0; j<3; j++) normal.add(vertexNormals[triIndices[tri][j]]);
          }
          else {
            var d01 = new THREE.Vector3().subVectors(
              vertices[triangle.a],
              vertices[triangle.b]
            );
            var d02 = new THREE.Vector3().subVectors(
              vertices[triangle.a],
              vertices[triangle.c]
            );
            normal.crossVectors(d01, d02);
          }
          normal.normalize();
          triangle.normal = normal;
        }
        return triangles;
      }
    }

    _this.baseMesh.geometry = geo;
    _this.computeBoundingBox();
  }
}*/

// Delete the THREE.Mesh because these wouldn't be automatically disposed of
// when the Model instance disappears.
Model.prototype.dispose = function() {
  if (!this.scene) return;

  removeMeshByName(this.scene, "base");
  removeMeshByName(this.scene, "slice");
  removeMeshByName(this.scene, "centerOfMassIndicator");
}
