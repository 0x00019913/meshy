/* stage.js

   classes:

   - Stage
   description:
    Main class representing the Meshy viewport. Encompasses UI, creating and
    handling the model, and controlling the viewport.
*/

// Constructor.
Stage = function() {
  this.dbg = false;

  this.units = Units.mm;

  // params
  this.buildVolumeSize = new THREE.Vector3(145, 145, 175);
  this.buildVolumeMin = null;
  this.buildVolumeMax = null;
  this.centerOriginOnBuildPlate = false; // todo: back to false
  this.buildVolumeMaterials = {
    linePrimary: new THREE.LineBasicMaterial({
      color: 0xdddddd,
      linewidth: 1
    }),
    lineSecondary: new THREE.LineBasicMaterial({
      color: 0x777777,
      linewidth: 1
    }),
    lineTertiary: new THREE.LineBasicMaterial({
      color: 0x444444,
      linewidth: 1
    }),
    floorPlane: new THREE.MeshStandardMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.5
    })
  };

  // toggles
  this.importEnabled = true;
  this.importingMeshName = "";
  this.buildVolumeVisible = true;

  this.importUnits = Units.mm;
  this.autocenterOnImport = true; // todo: back to true

  // geometry
  this.model = null;
  var fileInput = document.createElement("input");
  fileInput.id = "file";
  fileInput.type = "file";
  fileInput.onchange = function() { stage.handleFile(this.files[0]); };
  document.body.appendChild(fileInput);
  this.fileInput = fileInput;

  this.isLittleEndian = true;
  this.vertexPrecision = 5;
  this.displayPrecision = 4;

  // webgl viewport
  this.container = document.getElementById("container");
  this.camera = null;
  this.scene = null;
  this.renderer = null;
  this.axisWidget = null;
  this.printout = new Printout();
  this.progressBarContainer = document.getElementById("progressBarContainer");

  // verify that WebGL is enabled
  if (!Detector.webgl) {
    var webGLWarning = document.createElement("div");
    webGLWarning.innerHTML = "Welp! Your browser doesn't support WebGL. This page will remain blank."
    webGLWarning.style.paddingTop = "100px";
    container.appendChild(webGLWarning);
    return;
  }

  // standard notifications
  this.printout.log("Meshy is freely available under the MIT license. Thanks for using!");
  this.printout.log("Supported import formats: OBJ, STL.");
  this.printout.log("Controls: LMB (turn), MMB (pan/zoom), RMB (pan), F (center on model), C (center of mass), W (wireframe), B (build volume), G (gizmo)");

  // undo stack
  this.editStack = new EditStack(this.printout);

  // UI
  this.generateUI();
}

// Creates the dat.gui element and the InfoBox, initializes the viewport,
// initializes build volume.
Stage.prototype.generateUI = function() {
  this.gui = new dat.GUI();
  this.gui.add(this, "import").name("Import").title("Import a mesh.");

  var importSettingsFolder = this.gui.addFolder("Import Settings", "Defaults for the imported mesh.");
  importSettingsFolder.add(this, "importUnits", { mm: Units.mm, cm: Units.cm, inches: Units.inches })
    .name("Import units")
    .title("Units of the imported mesh.");
  importSettingsFolder.add(this, "autocenterOnImport").name("Autocenter")
    .title("Autocenter the mesh upon importing.");

  var exportFolder = this.gui.addFolder("Export", "Mesh export.");
  this.filename = "meshy";
  this.filenameController = exportFolder.add(this, "filename").name("Filename")
    .title("Filename for the exported mesh.");
  exportFolder.add(this, "exportOBJ").name("Export OBJ")
    .title("Export as OBJ file.");
  exportFolder.add(this, "exportSTL").name("Export STL")
    .title("Export as binary STL file.");
  exportFolder.add(this, "exportSTLascii").name("Export ASCII STL")
    .title("Export as ASCII STL file.");

  var settingsFolder = this.gui.addFolder("Settings", "Settings for computation.");

  settingsFolder.add(this, "isLittleEndian").name("Little endian")
    .title("Endianness toggle for imports and exports.");
  settingsFolder.add(this, "vertexPrecision").name("Vertex precision")
    .onChange(this.setVertexPrecision.bind(this))
    .title("Precision p; 10^p is used as a conversion factor between floating-point and fixed-point coordinates.");


  var displayFolder = this.gui.addFolder("Display", "Mesh and build volume display settings.");

  displayFolder.add(this, "displayPrecision", 0, 7).step(1).name("Display precision")
    .onChange(this.setDisplayPrecision.bind(this))
    .title("Maximal number of decimal places for displaying floating-point values.");
  displayFolder.add(this, "toggleGizmo").name("Toggle gizmo")
    .title("Toggle transform gizmo visibility.");
  displayFolder.add(this, "toggleAxisWidget").name("Toggle axis widget")
    .title("Toggle axis widget visibility.");
  displayFolder.add(this, "toggleWireframe").name("Toggle wireframe")
    .title("Toggle mesh wireframe.");
  displayFolder.add(this, "cameraToModel").name("Camera to model")
    .title("Snap camera to model.");
  this.backgroundColor = "#222222";
  this.meshColor = "#662828"; // todo: reset to 0xffffff
  this.wireframeColor = "#000000";
  this.meshRoughness = 0.3;
  this.meshMetalness = 0.5;
  this.backgroundColorController =
    displayFolder.addColor(this, "backgroundColor").name("Background color")
      .onChange(this.setBackgroundColor.bind(this))
      .title("Set background color.");
    this.meshColorController =
      displayFolder.addColor(this, "meshColor").name("Mesh color")
        .onChange(this.setMeshMaterial.bind(this))
        .title("Set mesh color.");
  displayFolder.add(this, "meshRoughness", 0, 1).name("Mesh roughness").onChange(this.setMeshMaterial.bind(this))
    .title("Set mesh roughness.");
  displayFolder.add(this, "meshMetalness", 0, 1).name("Mesh metalness").onChange(this.setMeshMaterial.bind(this))
    .title("Set mesh metalness.");
  this.meshColorController =
  displayFolder.addColor(this, "wireframeColor").name("Wireframe color")
    .onChange(this.setWireframeMaterial.bind(this))
    .title("Set wireframe color.");
  var buildVolumeFolder = displayFolder.addFolder("Build Volume", "Size and visibility settings for the build volume.");
  buildVolumeFolder.add(this, "toggleBuildVolume").name("Toggle volume")
    .title("Toggle build volume visibility.");
  buildVolumeFolder.add(this, "centerOriginOnBuildPlate").name("Center origin")
    .title("Center the origin on the floor of the build volume or place it in the corner.")
    .onChange(this.makeBuildVolume.bind(this));
  this.buildVolumeXController = buildVolumeFolder.add(this.buildVolumeSize, "x", 0)
    .name("Build volume x")
    .title("Build volume size on x in mm.")
    .onChange(this.makeBuildVolume.bind(this));
  this.buildVolumeYController = buildVolumeFolder.add(this.buildVolumeSize, "y", 0)
    .name("Build volume y")
    .title("Build volume size on y in mm.")
    .onChange(this.makeBuildVolume.bind(this));
  this.buildVOlumeZController = buildVolumeFolder.add(this.buildVolumeSize, "z", 0)
    .name("Build volume z")
    .title("Build volume size on z in mm.")
    .onChange(this.makeBuildVolume.bind(this));

  this.snapTransformationsToFloor = true;

  this.editFolder = this.gui.addFolder("Edit",
    "Mesh edit functions: translation, scaling, rotation, normals.");

  var calculationFolder = this.gui.addFolder("Calculate", "Calculate global mesh parameters.");
  calculationFolder.add(this, "calcSurfaceArea").name("Surface area")
    .title("Calculate mesh surface area.");
  calculationFolder.add(this, "calcVolume").name("Volume")
    .title("Calculate mesh volume.");
  calculationFolder.add(this, "calcCenterOfMass").name("Center of mass")
    .title("Calculate mesh center of mass.");
  calculationFolder.add(this, "toggleCOM").name("Toggle COM")
    .title("Toggle the center of mass indicator.");

  var measurementFolder = this.gui.addFolder("Measure", "Make calculations based on mouse-placed markers.");
  measurementFolder.add(this, "mLength").name("Length")
    .title("Measure point-to-point length.");
  measurementFolder.add(this, "mAngle").name("Angle")
    .title("Measure angle (in degrees) between two segments formed by three consecutive points.");
  measurementFolder.add(this, "mCircle").name("Circle")
    .title("Circle measurement: radius, diameter, circumference, arc length.");
  measurementFolder.add(this, "mCrossSectionX").name("Cross-section x")
    .title("Measure cross-section on x axis.");
  measurementFolder.add(this, "mCrossSectionY").name("Cross-section y")
    .title("Measure cross-section on y axis.");
  measurementFolder.add(this, "mCrossSectionZ").name("Cross-section z")
    .title("Measure cross-section on z axis.");
  measurementFolder.add(this, "mDeactivate").name("End measurement")
    .title("Turn off the current measurement.");

  var thicknessFolder = this.gui.addFolder("Mesh Thickness", "Visualize approximate local mesh thickness.");
  this.thicknessThreshold = 0.1;
  thicknessFolder.add(this, "thicknessThreshold", 0).name("Threshold")
    .title("Thickness threshold: parts of the mesh below this thickness are shown as too thin.");
  thicknessFolder.add(this, "viewThickness").name("View thickness")
    .title("Calculate mesh thickness: parts of the mesh that are too thin are shown in a color interpolated over the [threshold, 0] range.");
  thicknessFolder.add(this, "clearThicknessView").name("Clear thickness view")
    .title("Clear the color indicating parts of the mesh that are too thin.");

  var repairFolder = this.gui.addFolder("Repair (beta)", "Repair missing polygons.");
  repairFolder.add(this, "generatePatch").name("Generate patch")
    .title("Generate a patch of faces to make the mesh manifold.");
  repairFolder.add(this, "acceptPatch").name("Accept patch")
    .title("Integrate the patch into the mesh.");
  repairFolder.add(this, "cancelPatch").name("Cancel patch")
    .title("Remove the generated patch.");

  this.layerHeight = .05;//todo: back to 0.1
  this.lineWidth = 0.05;
  this.upAxis = "z";
  this.supportSliceFolder = this.gui.addFolder("Supports & Slicing (beta)",
    "Generate supports, slice the mesh, and export the resulting G-code.");
  this.supportAngle = 45;
  this.supportSpacingFactor = 6;
  this.supportRadius = this.lineWidth * 2;
  this.supportTaperFactor = 0.5;
  this.supportSubdivs = 16;
  // can't set support radius fn directly from dat.gui because it returns the
  // function stringified, so just set fn name and then convert it to the fn
  this.supportRadiusFnMap = {
    constant: SupportGenerator.RadiusFunctions.constant,
    sqrt: SupportGenerator.RadiusFunctions.sqrt
  };
  this.supportRadiusFnName = "sqrt";
  this.supportRadiusFnK = 0.01;
  this.sliceMode = Slicer.Modes.preview; // todo: back to preview
  this.sliceModeOn = false;
  this.slicePreviewModeSliceMesh = true;
  this.sliceFullModeUpToLayer = true;
  this.sliceFullModeShowInfill = false;
  this.sliceNumWalls = 2;
  this.sliceNumTopLayers = 10;
  this.sliceOptimizeTopLayers = true;
  this.sliceInfillType = Slicer.InfillTypes.grid; // todo: back to solid
  this.sliceInfillDensity = 0.1;
  this.sliceInfillOverlap = 0.5;
  // raft options
  // todo: all to reasonable values
  this.sliceMakeRaft = true; // todo: back to true
  this.sliceRaftNumTopLayers = 3;
  this.sliceRaftTopLayerHeight = 0.05;
  this.sliceRaftTopLineWidth = 0.05;
  this.sliceRaftTopDensity = 1.0;
  this.sliceRaftNumBaseLayers = 1;
  this.sliceRaftBaseLayerHeight = 0.1;
  this.sliceRaftBaseLineWidth = 0.1;
  this.sliceRaftBaseDensity = 0.5;
  this.sliceRaftOffset = 1.0;
  this.sliceRaftGap = 0.05;
  this.sliceRaftWriteWalls = false;
  // gcode options
  this.gcodeFilename = this.filename;
  this.gcodeExtension = "gcode";
  this.gcodeTemperature = 200;
  this.gcodeFilamentDiameter = 2.5;
  this.gcodePrimeExtrusion = 3;
  this.gcodeExtrusionMultiplier = 1.0;
  this.gcodeInfillSpeed = 70;
  this.gcodeWallSpeed = 30;
  this.gcodeRaftBasePrintSpeed = 25;
  this.gcodeRaftTopPrintSpeed = 30;
  this.gcodeTravelSpeed = 150;
  this.gcodeCoordinatePrecision = 3;
  this.gcodeExtruderPrecision = 5;
  this.buildSupportSliceFolder();

  this.gui.add(this, "undo").name("Undo")
    .title("Undo the last edit action.");
  this.gui.add(this, "redo").name("Redo")
    .title("Redo the previous undo.");
  this.gui.add(this, "delete").name("Delete")
    .title("Delete the mesh.");

  this.infoBox = new InfoBox(this.displayPrecision);
  this.infoBox.add("Units", this, "units");
  this.infoBox.add("Polycount", this, ["model","getPolycount"]);
  this.infoBox.addMultiple("x range", this, [["model","getxmin"], ["model","getxmax"]]);
  this.infoBox.addMultiple("y range", this, [["model","getymin"], ["model","getymax"]]);
  this.infoBox.addMultiple("z range", this, [["model","getzmin"], ["model","getzmax"]]);
  this.infoBox.addMultiple("Center", this, [["model", "getCenterx"],["model", "getCentery"],["model", "getCenterz"]]);
  this.infoBox.addMultiple("Size", this, [["model", "getSizex"],["model", "getSizey"],["model", "getSizez"]]);
  this.infoBox.add("Surface area", this, ["model","surfaceArea"],"[calculate]");
  this.infoBox.add("Volume", this, ["model", "volume"], "[calculate]");
  this.infoBox.addMultiple("Center of mass", this, [["model","getCOMx"], ["model","getCOMy"], ["model","getCOMz"]], "[calculate]");

  this.initViewport();
  this.makeBuildVolume();

  // gizmo creation:
  // set parameters, building the gizmo outward - first scale handles, then
  // normal rotate handles, then orthogonal handle(s), then translate handles;
  // this ensures that everything is spaced correctly

  this.gizmoSpacing = 1;

  // current radial boundary; next handle begins one spacing unit away from here
  var gizmoEdge = 0;

  this.gizmoScaleHandleRadius = 1.5;
  this.gizmoScaleHandleHeight = 4.0;
  this.gizmoScaleHandleRadialSegments = 32;
  this.gizmoScaleHandleOffset = 14;
  this.gizmoScaleOrthogonalHandleRadius = 3.0;
  this.gizmoScaleOrthogonalHandleWidthSegments = 32;
  this.gizmoScaleOrthogonalHandleHeightSegments = 16;

  // edge of the
  gizmoEdge = this.gizmoScaleHandleOffset + this.gizmoScaleHandleHeight / 2;

  this.gizmoRotateHandleWidth = 0.6;
  this.gizmoRotateHandleHeight = this.gizmoRotateHandleWidth;
  this.gizmoRotateHandleOuterRadius =
    gizmoEdge + this.gizmoSpacing + this.gizmoRotateHandleWidth / 2;
  this.gizmoRotateHandleRadialSegments = 64;

  gizmoEdge = this.gizmoRotateHandleOuterRadius;

  this.gizmoRotateOrthogonalHandleOuterRadius =
    this.gizmoRotateHandleOuterRadius + this.gizmoSpacing + this.gizmoRotateHandleWidth;

  gizmoEdge = this.gizmoRotateOrthogonalHandleOuterRadius;

  this.gizmoTranslateHandleRadius = 1.5;
  this.gizmoTranslateHandleHeight = 6.0;
  this.gizmoTranslateHandleRadialSegments = 32;
  this.gizmoTranslateHandleOffset =
    gizmoEdge + this.gizmoSpacing + this.gizmoTranslateHandleHeight / 2;

  this.gizmoTranslateOrthogonalHandleWidth = 8,
  this.gizmoTranslateOrthogonalHandleHeight = 4,
  this.gizmoTranslateOrthogonalHandleThickness = 2,
  this.gizmoTranslateOrthogonalHandleInset = 2,
  this.gizmoTranslateOrthogonalHandleOffset =
    this.gizmoRotateOrthogonalHandleOuterRadius + this.gizmoSpacing + 3;

  this.gizmoScaleFactor = 0.003;
  this.gizmoColliderInflation = 0.5;

  var _this = this;

  this.gizmo = new Gizmo(this.camera, this.renderer.domElement, {
    scaleHandleRadius: this.gizmoScaleHandleRadius,
    scaleHandleHeight: this.gizmoScaleHandleHeight,
    scaleHandleRadialSegments: this.gizmoScaleHandleRadialSegments,
    scaleHandleOffset: this.gizmoScaleHandleOffset,
    scaleOrthogonalHandleRadius: this.gizmoScaleOrthogonalHandleRadius,
    scaleOrthogonalHandleWidthSegments: this.gizmoScaleOrthogonalHandleWidthSegments,
    scaleOrthogonalHandleHeightSegments: this.gizmoScaleOrthogonalHandleHeightSegments,

    rotateHandleOuterRadius: this.gizmoRotateHandleOuterRadius,
    rotateOrthogonalHandleOuterRadius: this.gizmoRotateOrthogonalHandleOuterRadius,
    rotateHandleWidth: this.gizmoRotateHandleWidth,
    rotateHandleHeight: this.gizmoRotateHandleHeight,
    rotateHandleRadialSegments: this.gizmoRotateHandleRadialSegments,

    translateHandleRadius: this.gizmoTranslateHandleRadius,
    translateHandleHeight: this.gizmoTranslateHandleHeight,
    translateHandleRadialSegments: this.gizmoTranslateHandleRadialSegments,
    translateHandleOffset: this.gizmoTranslateHandleOffset,
    translateOrthogonalHandleWidth: this.gizmoTranslateOrthogonalHandleWidth,
    translateOrthogonalHandleHeight: this.gizmoTranslateOrthogonalHandleHeight,
    translateOrthogonalHandleThickness: this.gizmoTranslateOrthogonalHandleThickness,
    translateOrthogonalHandleInset: this.gizmoTranslateOrthogonalHandleInset,
    translateOrthogonalHandleOffset: this.gizmoTranslateOrthogonalHandleOffset,

    scaleFactor: this.gizmoScaleFactor,
    colliderInflation: this.gizmoColliderInflation,

    onTransform: function() { _this.controls.disable(); },
    onFinishTransform: function() { _this.controls.enable(); },

    getPosition: function() { return _this.position.clone(); },
    setPosition: function(pos) { _this.position.copy(pos); },
    onTranslate: this.onTranslate.bind(this),
    onFinishTranslate: this.onFinishTranslate.bind(this),

    getRotation: function() { return _this.rotation.clone(); },
    setRotation: function(euler) { _this.rotation.copy(euler); },
    onRotate: this.onRotate.bind(this),
    onFinishRotate: this.onFinishRotate.bind(this),

    getScale: function() { return _this.scale.clone(); },
    setScale: function(scale) { _this.scale.copy(scale); },
    onScale: this.onScaleByFactor.bind(this),
    onFinishScale: this.onFinishScaleByFactor.bind(this)
  });

  this.gizmo.visible = false;
  //this.gizmo.position.copy(this.calculateBuildPlateCenter());

  this.gizmoScene.add(this.gizmo);

  // handle the state of the transformation snap checkbox
  this.handleSnapTransformationToFloorState();
}

// anything that needs to be refreshed by hand (not in every frame)
Stage.prototype.updateUI = function() {
  this.filenameController.updateDisplay();
}

// used for internal optimization while building a list of unique vertices
Stage.prototype.setVertexPrecision = function() {
  if (this.model) this.model.setVertexPrecision(this.vertexPrecision);
}
Stage.prototype.setDisplayPrecision = function() {
  if (this.infoBox) this.infoBox.decimals = this.displayPrecision;

  this.setFolderDisplayPrecision(this.editFolder);
}

// Functions corresponding to buttons in the dat.gui.
Stage.prototype.exportOBJ = function() { this.export("obj"); }
Stage.prototype.exportSTL = function() { this.export("stl"); }
Stage.prototype.exportSTLascii = function() { this.export("stlascii"); }

Stage.prototype.undo = function() {
  this.deactivateSliceMode();
  this.gizmo.transformFinish();
  try {
    this.editStack.undo();
  }
  catch (e) {
    this.printout.warn(e);
  }
}
Stage.prototype.redo = function() {
  this.deactivateSliceMode();
  this.gizmo.transformFinish();
  try {
    this.editStack.redo();
  }
  catch (e) {
    this.printout.warn(e);
  }
}

// functions for handling model transformations

Stage.prototype.makeTranslateTransform = function(invertible) {
  if (this.dbg) console.log("make translate transform");
  var transform = new Transform("translate", this.model.getPosition());
  var _this = this;

  transform.rectify = function(pos) {
    pos = pos.clone();
    // if snapping to floor, floor the model
    if (_this.snapTransformationsToFloor) {
      pos.z = _this.model.getSize().z / 2;
    }
    return pos;
  }
  transform.onApply = function(pos) { _this.model.translate(pos); };
  transform.onEnd = function() { _this.model.translateEnd(); };
  transform.invertible = invertible;

  return transform;
}

Stage.prototype.makeFloorTransform = function(invertible) {
  if (this.dbg) console.log("make floor transform");
  var transform = new Transform("floor", this.model.getPosition()), _this = this;

  transform.onApply = function(pos) { _this.model.translate(pos); };
  transform.onEnd = function() { _this.model.translateEnd(); };
  transform.invertible = invertible;

  return transform;
}

Stage.prototype.makeRotateTransform = function(invertible) {
  if (this.dbg) console.log("make rotate transform");
  var transform = new Transform("rotate", this.model.getRotation()), _this = this;

  transform.onApply = function(euler) { _this.model.rotate(euler); };
  transform.onEnd = function() {
    _this.model.rotateEnd();
    if (_this.snapTransformationsToFloor) _this.floor(false);
  };
  transform.invertible = invertible;

  return transform;
}

Stage.prototype.makeScaleTransform = function(invertible) {
  if (this.dbg) console.log("make scale transform");
  var transform = new Transform("scale", this.model.getScale()), _this = this;

  transform.onApply = function(scale) {
    scale = scale.clone();
    // never scale to 0
    if (scale.x <= 0) scale.x = 1;
    if (scale.y <= 0) scale.y = 1;
    if (scale.z <= 0) scale.z = 1;
    _this.model.scale(scale);
  };
  transform.onEnd = function() {
    _this.model.scaleEnd();
    if (_this.snapTransformationsToFloor) _this.floor(false);
  };
  transform.invertible = invertible;

  return transform;
}

Stage.prototype.pushEdit = function(transform, onTransform) {
  if (transform && transform.invertible && !transform.noop()) {
    this.editStack.push(transform, onTransform);
  }
}

// called when a translation is in progress
Stage.prototype.onTranslate = function() {
  if (this.dbg) console.log("translate");
  if (!this.currentTransform) this.currentTransform = this.makeTranslateTransform();

  this.currentTransform.apply(this.position);
}
// called on translation end
Stage.prototype.onFinishTranslate = function() {
  if (this.dbg) console.log("finish translate");
  if (this.currentTransform) this.currentTransform.end();

  this.pushEdit(this.currentTransform, this.updatePosition.bind(this));

  this.currentTransform = null;
  this.updatePosition();
}

Stage.prototype.onChangeRotationDegrees = function() {
  // translate rotation in degrees to rotation in radians
  this.rotation.copy(eulerRadNormalize(eulerDegToRad(this.rotationDeg)));

  this.onRotate();
}

// called when a rotation is in progress
Stage.prototype.onRotate = function() {
  if (this.dbg) console.log("rotate");
  if (!this.currentTransform) this.currentTransform = this.makeRotateTransform();

  this.currentTransform.apply(this.rotation);
}
// called on rotation end
Stage.prototype.onFinishRotate = function() {
  if (this.dbg) console.log("finish rotate");
  if (this.currentTransform) this.currentTransform.end();

  //if (this.snapTransformationsToFloor) this.floor(false);

  this.pushEdit(this.currentTransform, this.updateRotation.bind(this));

  this.currentTransform = null;
  this.updateRotation();
  this.updatePosition();
  this.updateSize();
}

// called when scale change is in progress
Stage.prototype.onScaleByFactor = function() {
  if (this.dbg) console.log("scale");
  if (!this.currentTransform) this.currentTransform = this.makeScaleTransform();

  this.currentTransform.apply(this.scale);
}
// called when scaling to size is in progress
Stage.prototype.onScaleToSize = function() {
  // current size - changed dynamically via gui
  var size = this.size;
  // starting model size - only changes at the end of the transform
  var modelSize = this.model.getSize();

  // axis that's being scaled
  var axis = size.x !== modelSize.x ? "x" : size.y !== modelSize.y ? "y" : "z";
  // factor by which to scale (on one axis or all) - note zero-size failsafe
  var factor = size[axis] !== 0 ? size[axis] / modelSize[axis] : 1;

  // starting scale of model corresponding to the starting size
  var startScale = this.currentTransform ? this.currentTransform.startVal : this.scale;

  // set scale to a value that will result in the new size
  this.scale.copy(startScale.clone().multiplyScalar(factor));

  this.onScaleByFactor();
}
// called on scale change end
Stage.prototype.onFinishScaleByFactor = function() {
  if (this.dbg) console.log("finish scale");
  if (this.currentTransform) this.currentTransform.end();

  //if (this.snapTransformationsToFloor) this.floor(false);

  this.pushEdit(this.currentTransform, this.updateScale.bind(this));

  this.currentTransform = null;
  this.updatePosition();
  this.updateScale();
}

// instantaneous transformations - autocenter and floor

Stage.prototype.autoCenter = function(invertible) {
  var newCenter = this.calculateBuildPlateCenter();
  newCenter.z += this.model.getSize().z / 2;
  var translation = newCenter.sub(this.model.getCenter());

  var transform = this.makeTranslateTransform(invertible);

  transform.apply(this.position.add(translation).clone());
  transform.end();

  this.pushEdit(transform, this.updatePosition.bind(this));
  this.updatePosition();
}

Stage.prototype.floor = function(invertible) {
  if (!this.model) return;

  var transform = this.makeFloorTransform(invertible);

  this.position.z -= this.model.getMin().z;

  transform.apply(this.position.clone());
  transform.end();

  this.pushEdit(transform, this.updatePosition.bind(this));
  this.updatePosition();
}

// invoked when toggling the checkbox for snapping transformations to floor
Stage.prototype.handleSnapTransformationToFloorState = function() {
  var snap = this.snapTransformationsToFloor;

  // floor, but don't register the action as undoable
  if (snap) this.floor(false);

  if (snap) this.disableController(this.positionZController);
  else this.enableController(this.positionZController);

  if (snap) this.gizmo.disableHandle(Gizmo.HandleTypes.translate, "z");
  else this.gizmo.enableHandle(Gizmo.HandleTypes.translate, "z");
}

// position/rotation/scale GUI-updating functions
Stage.prototype.updatePosition = function() {
  if (!this.model) return;

  this.position.copy(this.model.getPosition());

  if (this.positionXController) this.positionXController.updateDisplay();
  if (this.positionYController) this.positionYController.updateDisplay();
  if (this.positionZController) this.positionZController.updateDisplay();
}
Stage.prototype.updateRotation = function() {
  if (!this.model) return;

  this.rotation.copy(eulerRadNormalize(this.model.getRotation()));
  this.rotationDeg.copy(eulerRadToDeg(this.rotation));

  if (this.rotationXController) this.rotationXController.updateDisplay();
  if (this.rotationYController) this.rotationYController.updateDisplay();
  if (this.rotationZController) this.rotationZController.updateDisplay();
}
Stage.prototype.updateScale = function() {
  if (!this.model) return;

  this.scale.copy(this.model.getScale());

  if (this.scaleXController) this.scaleXController.updateDisplay();
  if (this.scaleYController) this.scaleYController.updateDisplay();
  if (this.scaleZController) this.scaleZController.updateDisplay();

  this.updateSize();
}
Stage.prototype.updateSize = function() {
  if (!this.model) return;

  this.size.copy(this.model.getSize());

  if (this.scaleToSizeXController) this.scaleToSizeXController.updateDisplay();
  if (this.scaleToSizeYController) this.scaleToSizeYController.updateDisplay();
  if (this.scaleToSizeZController) this.scaleToSizeZController.updateDisplay();
}

Stage.prototype.buildEditFolder = function() {
  this.clearFolder(this.editFolder);

  this.editFolder.add(this, "snapTransformationsToFloor").name("Snap to floor")
    .title("Snap all transformations to the build volume floor.")
    .onChange(this.handleSnapTransformationToFloorState.bind(this));

  if (!this.model) {
    return;
  }

  // position vector
  this.position = new THREE.Vector3();
  // radian rotation (for internal use) and equivalent degree rotation (for display)
  this.rotation = new THREE.Euler();
  this.rotationDeg = new THREE.Euler();
  // vector of scale factors
  this.scale = new THREE.Vector3();
  // computed size of the model
  this.size = new THREE.Vector3();

  this.updatePosition();
  this.updateRotation();
  this.updateScale();
  this.updateSize();

  this.editFolder.add(this, "autoCenter").name("Autocenter")
    .title("Center the mesh on x and y; snap to the floor on z.");

  // transformation currently in progress
  this.currentTransform = null;

  var translateFolder = this.editFolder.addFolder("Translate", "Translate the mesh on a given axis.");
  this.positionXController = translateFolder.add(this.position, "x")
    .onChange(this.onTranslate.bind(this))
    .onFinishChange(this.onFinishTranslate.bind(this))
    .precision(4);
  this.positionYController = translateFolder.add(this.position, "y")
    .onChange(this.onTranslate.bind(this))
    .onFinishChange(this.onFinishTranslate.bind(this))
    .precision(4);
  this.positionZController = translateFolder.add(this.position, "z")
    .onChange(this.onTranslate.bind(this))
    .onFinishChange(this.onFinishTranslate.bind(this))
    .precision(4);
  // if snapping transformations to floor, might need to disable a controller
  this.handleSnapTransformationToFloorState();

  var rotateFolder = this.editFolder.addFolder("Rotate", "Rotate the mesh about a given axis.");
  this.rotationXController = rotateFolder.add(this.rotationDeg, "x", 0, 360)
    .onChange(this.onChangeRotationDegrees.bind(this))
    .onFinishChange(this.onFinishRotate.bind(this));
  this.rotationYController = rotateFolder.add(this.rotationDeg, "y", 0, 360)
    .onChange(this.onChangeRotationDegrees.bind(this))
    .onFinishChange(this.onFinishRotate.bind(this));
  this.rotationZController = rotateFolder.add(this.rotationDeg, "z", 0, 360)
    .onChange(this.onChangeRotationDegrees.bind(this))
    .onFinishChange(this.onFinishRotate.bind(this));

  var scaleFolder = this.editFolder.addFolder("Scale", "Scale the mesh by given criteria.");

  var scaleByFactorFolder = scaleFolder.addFolder("Scale by Factor", "Scale the mesh by a given factor ");
  this.scaleXController = scaleByFactorFolder.add(this.scale, "x", 0)
    .onChange(this.onScaleByFactor.bind(this))
    .onFinishChange(this.onFinishScaleByFactor.bind(this));
  this.scaleYController = scaleByFactorFolder.add(this.scale, "y", 0)
    .onChange(this.onScaleByFactor.bind(this))
    .onFinishChange(this.onFinishScaleByFactor.bind(this));
  this.scaleZController = scaleByFactorFolder.add(this.scale, "z", 0)
    .onChange(this.onScaleByFactor.bind(this))
    .onFinishChange(this.onFinishScaleByFactor.bind(this));

  var scaleToSizeFolder = scaleFolder.addFolder("Scale to Size", "Scale the mesh uniformly to a given size.");

  this.scaleToSizeXController = scaleToSizeFolder.add(this.size, "x", 0).name("x size")
    .onChange(this.onScaleToSize.bind(this))
    .onFinishChange(this.onFinishScaleByFactor.bind(this));
  this.scaleToSizeYController = scaleToSizeFolder.add(this.size, "y", 0).name("y size")
    .onChange(this.onScaleToSize.bind(this))
    .onFinishChange(this.onFinishScaleByFactor.bind(this));
  this.scaleToSizeZController = scaleToSizeFolder.add(this.size, "z", 0).name("z size")
    .onChange(this.onScaleToSize.bind(this))
    .onFinishChange(this.onFinishScaleByFactor.bind(this));

  this.scaleToMeasurementFolder = scaleFolder.addFolder("Scale to Measurement",
    "Set up a measurement and then scale the mesh such that the measurement will now equal the given value.");

  return;

  var ringSizeFolder = scaleFolder.addFolder("Scale To Ring Size",
    "Set up a circle measurement around the inner circumference of a ring mesh, then scale so that the mesh will have the correct measurement in mm.");
  ringSizeFolder.add(this, "mCircle").name("1. Mark circle")
    .title("Turn on the circle measurement tool and mark the inner circumference of the ring.");
  this.newRingSize = 0;
  ringSizeFolder.add(this, "newRingSize", ringSizes).name("2. New ring size")
    .title("Select ring size.");
  ringSizeFolder.add(this, "scaleToRingSize").name("3. Scale to size")
    .title("Scale the ring.");
  ringSizeFolder.add(this, "mDeactivate").name("4. End measurement")
    .title("Turn off the measurement tool when not in use.");

  var mirrorFolder = this.editFolder.addFolder("Mirror", "Mirror the mesh on a given axis.");
  mirrorFolder.add(this, "mirrorX").name("Mirror on x")
    .title("Mirror mesh on x axis.");
  mirrorFolder.add(this, "mirrorY").name("Mirror on y")
    .title("Mirror mesh on y axis.");
  mirrorFolder.add(this, "mirrorZ").name("Mirror on z")
    .title("Mirror mesh on z axis.");

  var floorFolder = this.editFolder.addFolder("Floor", "Floor the mesh on a given axis.");
  floorFolder.add(this, "floorX").name("Floor to x")
    .title("Floor the mesh on x axis.");
  floorFolder.add(this, "floorY").name("Floor to y")
    .title("Floor the mesh on y axis.");
  floorFolder.add(this, "floorZ").name("Floor to z")
    .title("Floor the mesh on z axis.");

  var centerFolder = this.editFolder.addFolder("Center", "Center the mesh on a given axis in the build volume.");
  centerFolder.add(this, "centerAll").name("Center on all")
    .title("Center the mesh on all axes.");
  centerFolder.add(this, "centerX").name("Center on x")
    .title("Center the mesh on x axis.");
  centerFolder.add(this, "centerY").name("Center on y")
    .title("Center the mesh on y axis.");
  //centerFolder.add(this, "centerZ").name("Center on z")
  //  .title("Center the mesh on z axis.");

  this.editFolder.add(this, "flipNormals").name("Flip normals")
    .title("Flip mesh normals.");
}
Stage.prototype.scaleToMeasurement = function() {
  if (this.model) {
    var currentValue = this.model.getMeasuredValue(this.measurementToScale);
    if (currentValue) {
      var ratio = this.newMeasurementValue/currentValue;
      if (this.measurementToScale=="crossSection") ratio = Math.sqrt(ratio);
      this.transform("scale","all",ratio);
    }
  }
}
Stage.prototype.flipNormals = function() { if (this.model) this.model.flipNormals(); }
Stage.prototype.calcSurfaceArea = function() { if (this.model) this.model.calcSurfaceArea(); }
Stage.prototype.calcVolume = function() { if (this.model) this.model.calcVolume(); }
Stage.prototype.calcCenterOfMass = function() { if (this.model) this.model.calcCenterOfMass(); }
Stage.prototype.mLength = function() { this.startMeasurement("length"); }
Stage.prototype.mAngle = function() { this.startMeasurement("angle"); }
Stage.prototype.mCircle = function() { this.startMeasurement("circle"); }
Stage.prototype.mCrossSectionX = function() { this.startMeasurement("crossSection","x"); }
Stage.prototype.mCrossSectionY = function() { this.startMeasurement("crossSection","y"); }
Stage.prototype.mCrossSectionZ = function() { this.startMeasurement("crossSection","z"); }
Stage.prototype.startMeasurement = function(type, param) {
  if (this.model) {
    this.model.activateMeasurement(type, param);
    this.buildScaleToMeasurementFolder();
  }
}
Stage.prototype.mDeactivate = function() {
  if (this.model) this.model.deactivateMeasurement();
  if (this.scaleToMeasurementFolder) this.clearFolder(this.scaleToMeasurementFolder);
}
Stage.prototype.viewThickness = function() {
  if (this.model) this.model.viewThickness(this.thicknessThreshold);
}
Stage.prototype.clearThicknessView = function() {
  if (this.model) this.model.clearThicknessView();
}
Stage.prototype.generatePatch = function() {
  this.deactivateSliceMode();
  if (this.model) this.model.generatePatch();
}
Stage.prototype.acceptPatch = function() {
  this.deactivateSliceMode();
  if (this.model) this.model.acceptPatch();
}
Stage.prototype.cancelPatch = function() {
  if (this.model) this.model.cancelPatch();
}
Stage.prototype.generateSupports = function() {
  if (this.model) {
    if (this.supportRadius < this.lineWidth) {
      this.printout.warn("Support radius is lower than the planar resolution.");
    }

    this.model.generateSupports({
      angle: this.supportAngle,
      resolution: this.lineWidth * this.supportSpacingFactor,
      layerHeight: this.layerHeight,
      radius: this.supportRadius,
      taperFactor: this.supportTaperFactor,
      subdivs: this.supportSubdivs,
      radiusFn: this.supportRadiusFnMap[this.supportRadiusFnName],
      radiusFnK: this.supportRadiusFnK,
      axis: this.upAxis
    });
  }
}
Stage.prototype.removeSupports = function() {
  if (this.model) this.model.removeSupports();
}
// build support & slicing folder
Stage.prototype.buildSupportSliceFolder = function() {
  var supportSliceFolder = this.supportSliceFolder;
  this.clearFolder(supportSliceFolder);

  if (this.sliceModeOn) {
    this.buildSliceFolder(supportSliceFolder);
  }
  else {
    supportSliceFolder.add(this, "layerHeight", .0001, 1).name("Layer height")
      .title("Height of each mesh slice layer.");
    supportSliceFolder.add(this, "lineWidth", .0001, 1).name("Line width")
      .title("Width of the print line. Affects minimum resolvable detail size, decimation of sliced contours, and extrusion in the exported G-code.");
    supportSliceFolder.add(this, "upAxis", ["x", "y", "z"]).name("Up axis")
      .title("Axis normal to the slicing planes.");

    var supportFolder = supportSliceFolder.addFolder("Supports", "Generate supports for printing the model.");
    this.buildSupportFolder(supportFolder);

    var sliceFolder = supportSliceFolder.addFolder("Slice", "Slice the mesh.");
    this.buildSliceFolder(sliceFolder);
  }
}
Stage.prototype.buildSupportFolder = function(folder) {
  folder.add(this, "supportAngle", 0, 90).name("Angle")
    .title("Angle defining faces that need support.");
  folder.add(this, "supportSpacingFactor", 1, 100).name("Spacing factor")
    .title("Greater spacing factor makes supports more sparse.");
  folder.add(this, "supportRadius", 0.0001, 1).name("Radius")
    .title("Base radius for supports. NB: if this radius is too low in comparison with line width, the supports may not print correctly.");
  folder.add(this, "supportTaperFactor", 0, 1).name("Taper factor")
    .title("Defines how much the supports taper when connected to the mesh.");
  folder.add(this, "supportSubdivs", 4).name("Subdivs")
    .title("Number of subdivisions in the cylindrical support struts.");
  folder.add(this, "supportRadiusFnName", ["constant", "sqrt"]).name("Radius function")
    .title("Function that defines how support radius grows with the volume it supports; default is square root.");
  folder.add(this, "supportRadiusFnK", 0).name("Function constant")
    .title("Multiplicative constant that modifies the support radius function.");
  folder.add(this, "generateSupports").name("Generate supports")
    .title("Generate the supports.");
  folder.add(this, "removeSupports").name("Remove supports")
    .title("Remove generated supports.");
}
Stage.prototype.buildSliceDisplayFolder = function(folder) {
  this.clearFolder(folder);

  if (this.sliceMode === Slicer.Modes.preview) {
    folder.add(this, "slicePreviewModeSliceMesh", true).name("Show sliced mesh")
      .onChange(this.updateSlicerDisplayParams.bind(this))
      .title("If checked, the mesh is shown sliced by the current slicing plane; else, the mesh is shown as a ghost.");
  }
  else if (this.sliceMode === Slicer.Modes.full) {
    folder.add(this, "sliceFullModeUpToLayer").name("Up to layer")
      .onChange(this.updateSlicerDisplayParams.bind(this))
      .title("Display all contours, or all contours up to a given layer.");
    folder.add(this, "sliceFullModeShowInfill").name("Show infill")
      .onChange(this.updateSlicerDisplayParams.bind(this))
      .title("Show infill if checked; default setting is false because infill makes the layers hard to see.");
  }
}
Stage.prototype.buildSliceFolder = function(folder) {
  this.clearFolder(folder);

  if (this.sliceModeOn) {
    var maxLevel = this.model.getMaxLevel();
    var minLevel = this.model.getMinLevel();

    this.currentSliceLevel = this.model.getCurrentSliceLevel();
    var sliceController = folder.add(this, "currentSliceLevel", minLevel, maxLevel)
      .name("Slice").step(1).onChange(this.setSliceLevel.bind(this))
      .title("Set the current slicing plane.");
    this.sliceMode = this.model.getSliceMode();
    folder.add(
      this,
      "sliceMode",
      { "preview": Slicer.Modes.preview, "full": Slicer.Modes.full }
    )
      .name("Mode").onChange(this.setSliceMode.bind(this))
      .title("Set slicer mode: preview mode shows the mesh sliced at a particular level; full mode shows all layers simultaneously.");

    this.sliceDisplayFolder = folder.addFolder("Display", "Display options for the current slice mode.");
    this.buildSliceDisplayFolder(this.sliceDisplayFolder);
  }
  this.buildLayerSettingsFolder(folder);
  this.buildRaftFolder(folder);
  this.buildGcodeFolder(folder);

  if (this.sliceModeOn) folder.add(this, "deactivateSliceMode").name("Slice mode off")
    .title("Turn slice mode off.");
  else folder.add(this, "activateSliceMode").name("Slice mode on")
    .title("Turn slice mode on.");
}
Stage.prototype.buildLayerSettingsFolder = function(folder) {
  var sliceLayerSettingsFolder = folder.addFolder("Layer Settings", "Settings for computing layers.");
  this.clearFolder(sliceLayerSettingsFolder);

  sliceLayerSettingsFolder.add(this, "sliceNumWalls", 1, 10).name("Walls").step(1)
    .title("Number of horizontal walls between the print exterior and the interior.");
  sliceLayerSettingsFolder.add(this, "sliceNumTopLayers", 1, 10).name("Top layers").step(1)
    .title("Number of layers of solid infill that must be present between the print interior and exterior in the vertical direction.");
  sliceLayerSettingsFolder.add(this, "sliceOptimizeTopLayers").name("Optimize top layers")
    .title("Calculate the top layers in an optimized way. This may result in slightly less accurate solid infill computation but should cheapen computation.");
  sliceLayerSettingsFolder.add(this, "sliceInfillType", {
    "none": Slicer.InfillTypes.none,
    "solid": Slicer.InfillTypes.solid,
    "grid": Slicer.InfillTypes.grid,
    "lines": Slicer.InfillTypes.lines,
    //"triangle": Slicer.InfillTypes.triangle,
    //"hex": Slicer.InfillTypes.hex
  }).name("Infill type")
    .title("Print infill type: fills the parts of each contour that aren't occupied by solid infill forming top layers. If 'none' is selected, solid top layer infill is still generated.");
  sliceLayerSettingsFolder.add(this, "sliceInfillDensity", 0, 1).name("Infill density")
    .title("0 density means no infill, 1 means solid.");
  sliceLayerSettingsFolder.add(this, "sliceInfillOverlap", 0, 1).name("Infill overlap")
    .title("Defines how much infill overlaps with the innermost wall. 0 gives a separation of a full line width, 1 means the printline of an infill line starts and ends on the centerline of the wall.");
  if (this.sliceModeOn) {
    sliceLayerSettingsFolder.add(this, "updateSlicerParams").name("Update params")
      .title("Update the layer parameters and recalculate as necessary.");
  }
}
Stage.prototype.buildRaftFolder = function(folder) {
  var sliceRaftFolder = folder.addFolder("Raft", "Settings for computing the raft.");
  this.clearFolder(sliceRaftFolder);

  sliceRaftFolder.add(this, "sliceMakeRaft").name("Make raft")
    .title("Checked if the slicer needs to generate a raft. The raft is formed from several layers of infill to provide initial adhesion to the build plate.");
  sliceRaftFolder.add(this, "sliceRaftNumBaseLayers", 0).step(1).name("Base layers")
    .title("Number of raft base layers. These layers are printed slowly to ensure initial adhesion.");
  sliceRaftFolder.add(this, "sliceRaftBaseLayerHeight", 0).name("Base height")
    .title("Print height of the raft base layers.");
  sliceRaftFolder.add(this, "sliceRaftBaseLineWidth", 0).name("Base width")
    .title("Line width of the raft base layers.");
  sliceRaftFolder.add(this, "sliceRaftBaseDensity", 0, 1).name("Base density")
    .title("Density of the infill forming the raft base layers.");
  sliceRaftFolder.add(this, "sliceRaftNumTopLayers", 0).step(1).name("Top layers")
    .title("Number of additional layers on top of the raft base layers.");
  sliceRaftFolder.add(this, "sliceRaftTopLayerHeight", 0).name("Top height")
    .title("Print height of the raft top layers.");
  sliceRaftFolder.add(this, "sliceRaftTopLineWidth", 0).name("Top width")
    .title("Line width of the raft top layers.");
  sliceRaftFolder.add(this, "sliceRaftTopDensity", 0, 1).name("Top density")
    .title("Density of the infill forming the raft top layers.");
  sliceRaftFolder.add(this, "sliceRaftOffset", 0).name("Offset")
    .title("Horizontal outward offset distance of the raft from the bottom of the mesh. A wider raft will adhere to the build plate better.");
  sliceRaftFolder.add(this, "sliceRaftGap", 0).name("Air gap")
    .title("Small air gap between the top of the raft and the bottom of the main print to make detaching the print easier.");
  sliceRaftFolder.add(this, "sliceRaftWriteWalls").name("Print perimeter")
    .title("Optionally print the raft with walls around the infill.");
  if (this.sliceModeOn) {
    sliceRaftFolder.add(this, "updateSlicerParams").name("Update raft params")
      .title("Update the raft parameters and recalculate as necessary.");
  }
}
Stage.prototype.buildGcodeFolder = function(folder) {
  var gcodeFolder = folder.addFolder("G-code", "Settings for computing the G-code.");
  this.clearFolder(gcodeFolder);

  this.gcodeFilenameController = gcodeFolder.add(this, "gcodeFilename").name("Filename")
    .title("Filename to save.");
  gcodeFolder.add(this, "gcodeExtension", { gcode: "gcode" }).name("Extension")
    .title("File extension.");
  gcodeFolder.add(this, "gcodeTemperature", 0).name("Temperature")
    .title("Extruder temperature.");
  gcodeFolder.add(this, "gcodeFilamentDiameter", 0.1, 5).name("Filament diameter")
    .title("Filament diameter (mm); affects the computation of how much to extrude.");
  gcodeFolder.add(this, "gcodePrimeExtrusion", 0).name("Prime extrusion")
    .title("Small length (mm) of filament to extrude for priming the nozzle.");
  gcodeFolder.add(this, "gcodeExtrusionMultiplier", 0).name("Extrusion multiplier")
    .title("Factor that can be used to tweak under- or over-extrusion. Directly multiplies gcode extrusion values. Default is 1.");
  gcodeFolder.add(this, "gcodeInfillSpeed", 0).name("Infill speed")
    .title("Speed (mm/s) at which infill is printed. Infill is less sensitive to accuracy issues, so it can be printed more quickly than the walls.");
  gcodeFolder.add(this, "gcodeWallSpeed", 0).name("Wall speed")
    .title("Speed (mm/s) at which the walls are printed.");
  gcodeFolder.add(this, "gcodeRaftBasePrintSpeed", 0).name("Raft base speed")
    .title("Speed (mm/s) at which the raft base layer should be printed. Should be slow so that the layer is thick and adheres properly.");
  gcodeFolder.add(this, "gcodeRaftTopPrintSpeed", 0).name("Raft top speed")
    .title("Speed (mm/s) at which the raft top layer should be printed.");
  gcodeFolder.add(this, "gcodeTravelSpeed", 0).name("Travel speed")
    .title("Speed (mm/s) at which the extruder travels while not printing.");
  gcodeFolder.add(this, "gcodeCoordinatePrecision", 0).name("Coord precision")
    .title("Number of digits used for filament position coordinates. More digits increases file size.");
  gcodeFolder.add(this, "gcodeExtruderPrecision", 0).name("Extruder precision")
    .title("Number of digits used for extrusion values. More digits increases file size.");
  if (this.sliceModeOn) {
    gcodeFolder.add(this, "gcodeSave", 0).name("Save G-code")
      .title("Generate g-code and save it to a file.");
  }
}
Stage.prototype.setSliceMode = function() {
  if (this.model) {
    this.model.setSliceMode(this.sliceMode);
    this.buildSliceDisplayFolder(this.sliceDisplayFolder);
  }
}
Stage.prototype.updateSlicerDisplayParams = function() {
  if (this.model) {
    this.model.updateSlicerParams({
      previewSliceMesh: this.slicePreviewModeSliceMesh,
      fullUpToLayer: this.sliceFullModeUpToLayer,
      fullShowInfill: this.sliceFullModeShowInfill
    });
    this.setSliceLevel();
  }
}
Stage.prototype.updateSlicerParams = function() {
  if (this.model) {
    this.model.updateSlicerParams(this.makeSlicerParams());
  }
  this.setSliceLevel();
}
Stage.prototype.activateSliceMode = function() {
  if (this.model) {
    this.sliceModeOn = true;
    this.model.activateSliceMode(this.makeSlicerParams());
    this.buildSliceFolder(this.supportSliceFolder);
  }
}
Stage.prototype.makeSlicerParams = function() {
  return {
    mode: this.sliceMode,
    axis: this.upAxis,
    layerHeight: this.layerHeight,
    lineWidth: this.lineWidth,
    numWalls: this.sliceNumWalls,
    numTopLayers: this.sliceNumTopLayers,
    optimizeTopLayers: this.sliceOptimizeTopLayers,
    infillType: parseInt(this.sliceInfillType),
    infillDensity: this.sliceInfillDensity,
    infillOverlap: this.sliceInfillOverlap,
    makeRaft: this.sliceMakeRaft,
    raftNumTopLayers: this.sliceRaftNumTopLayers,
    raftTopLayerHeight: this.sliceRaftTopLayerHeight,
    raftTopLineWidth: this.sliceRaftTopLineWidth,
    raftTopDensity: this.sliceRaftTopDensity,
    raftNumBaseLayers: this.sliceRaftNumBaseLayers,
    raftBaseLayerHeight: this.sliceRaftBaseLayerHeight,
    raftBaseLineWidth: this.sliceRaftBaseLineWidth,
    raftBaseDensity: this.sliceRaftBaseDensity,
    raftOffset: this.sliceRaftOffset,
    raftGap: this.sliceRaftGap,
    raftWriteWalls: this.sliceRaftWriteWalls,
    precision: this.vertexPrecision,
    // display params
    previewSliceMesh: this.slicePreviewModeSliceMesh,
    fullUpToLayer: this.sliceFullModeUpToLayer,
    fullShowInfill: this.sliceFullModeShowInfill
  };
}
Stage.prototype.makeGcodeParams = function() {
  return {
    filename: this.gcodeFilename,
    extension: this.gcodeExtension,
    temperature: this.gcodeTemperature,
    filamentDiameter: this.gcodeFilamentDiameter,
    primeExtrusion: this.gcodePrimeExtrusion,
    extrusionMultiplier: this.gcodeExtrusionMultiplier,
    infillSpeed: this.gcodeInfillSpeed,
    wallSpeed: this.gcodeWallSpeed,
    raftBasePrintSpeed: this.gcodeRaftBasePrintSpeed,
    raftTopPrintSpeed: this.gcodeRaftTopPrintSpeed,
    travelSpeed: this.gcodeTravelSpeed,
    coordPrecision: this.gcodeCoordinatePrecision,
    extruderPrecision: this.gcodeExtruderPrecision
  };
}
Stage.prototype.deactivateSliceMode = function() {
  if (this.model) {
    this.sliceModeOn = false;
    this.buildSupportSliceFolder();
    this.model.deactivateSliceMode();
  }
}
Stage.prototype.setSliceLevel = function() {
  if (this.model) {
    this.model.setSliceLevel(this.currentSliceLevel);
  }
}
Stage.prototype.gcodeSave = function() {
  if (this.model) {
    this.model.gcodeSave(this.makeGcodeParams());
  }
}
Stage.prototype.buildScaleToMeasurementFolder = function() {
  this.clearFolder(this.scaleToMeasurementFolder);
  if (this.model) this.scalableMeasurements = this.model.getScalableMeasurements();
  if (this.scalableMeasurements && this.scalableMeasurements.length>0) {
    this.measurementToScale = this.scalableMeasurements[0];
    this.newMeasurementValue = 1;
    this.scaleToMeasurementFolder.add(this, "measurementToScale", this.scalableMeasurements).name("Measurement to scale")
      .title("Select an available measurement to which to scale.");
    this.scaleToMeasurementFolder.add(this, "newMeasurementValue", 0).name("New value")
      .title("New value by which to scale the mesh so that the measurement equals the given value.");
    this.scaleToMeasurementFolder.add(this, "scaleToMeasurement").name("Scale to measurement")
      .title("Scale the mesh.");
  }
}
Stage.prototype.clearFolder = function(folder) {
  for (var i=folder.__controllers.length-1; i>=0; i--) {
    folder.remove(folder.__controllers[i]);
  }
  for (var folderName in folder.__folders) {
    folder.removeFolder(folder.__folders[folderName]);
  }
}
Stage.prototype.disableController = function(controller) {
  if (!controller) return;

  controller.domElement.style.pointerEvents = "none";
  controller.domElement.style.opacity = 0.5;
}
Stage.prototype.enableController = function(controller) {
  if (!controller) return;

  controller.domElement.style.pointerEvents = "";
  controller.domElement.style.opacity = "";
}
Stage.prototype.setFolderDisplayPrecision = function(folder) {
  for (var ci = 0; ci < folder.__controllers.length; ci++) {
    var controller = folder.__controllers[ci];
    // if number controller, set precision
    if (isNumber(controller.initialValue)) {
      controller.precision(this.displayPrecision);
      controller.updateDisplay();
    }
  }

  for (var fkey in folder.__folders) {
    this.setFolderDisplayPrecision(folder.__folders[fkey]);
  }
}
Stage.prototype.scaleToRingSize = function() {
  if (this.model &&
  this.model.measurement.active &&
  this.scalableMeasurements.includes("diameter")) {
    var tmpVal = this.newMeasurementValue;
    var tmpType = this.measurementToScale;

    this.newMeasurementValue = this.newRingSize;
    this.measurementToScale = "diameter";
    this.scaleToMeasurement();

    this.newMeasurementValue = tmpVal;
    this.measurementToScale = tmpType;
  }
  else {
    this.printout.warn("A circle measurement must be active to scale to ring size.");
  }
}

Stage.prototype.toggleBuildVolume = function() {
  this.buildVolumeVisible = !this.buildVolumeVisible;
  this.setBuildVolumeState();
}
Stage.prototype.setBuildVolumeState = function() {
  var visible = this.buildVolumeVisible;
  this.scene.traverse(function(o) {
    if (o.name=="buildVolume") o.visible = visible;
  });
}
Stage.prototype.toggleGizmo = function() {
  if (!this.gizmo) return;

  var visible = this.gizmo.visible;
  this.gizmo.visible = !!this.model && !visible;
}
Stage.prototype.toggleCOM = function() {
  if (this.model) {
    this.model.toggleCenterOfMass();
  }
}
Stage.prototype.toggleWireframe = function() {
  if (this.model) this.model.toggleWireframe();
}
Stage.prototype.toggleAxisWidget = function() {
  this.axisWidget.toggleVisibility();
}
Stage.prototype.setBackgroundColor = function() {
  if (this.scene) this.scene.background.set(this.backgroundColor);
}
Stage.prototype.setMeshMaterial = function() {
  if (this.model) this.model.setMeshMaterial(this.meshColor, this.meshRoughness, this.meshMetalness);
}
Stage.prototype.setWireframeMaterial = function() {
  if (this.model) this.model.setWireframeMaterial(this.wireframeColor);
}

// Initialize the viewport, set up everything with WebGL including the
// axis widget.
Stage.prototype.initViewport = function() {
  var width, height;
  var _this = this;

  init();
  animate();

  function init() {
    height = container.offsetHeight;
    width = container.offsetWidth;

    _this.camera = new THREE.PerspectiveCamera(30, width/height, .1, 10000);
    // z axis is up as is customary for 3D printers
    _this.camera.up.set(0, 0, 1);

    _this.scene = new THREE.Scene();
    _this.scene.background = new THREE.Color(_this.backgroundColor);
    debug = new Debug(_this.scene); // todo: remove

    _this.gizmoScene = new THREE.Scene();

    _this.controls = new Controls(
      _this.camera,
      _this.container,
      {
        r: _this.buildVolumeSize.length() * 1,
        phi: 0,
        theta: 5*Math.PI/12,
        origin: _this.defaultCameraCenter()
      }
    );

    // for lighting the scene
    var pointLight = new THREE.PointLight(0xffffff, 3);
    _this.scene.add(pointLight);
    _this.controls.addObject(pointLight);
    // for lighting the gizmo
    var gizmoPointLight = pointLight.clone();
    _this.gizmoScene.add(gizmoPointLight);
    _this.controls.addObject(gizmoPointLight);

    var ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    _this.scene.add(ambientLight);
    _this.gizmoScene.add(ambientLight);

    _this.axisWidget = new AxisWidget(_this.camera);

    _this.controls.update();

    /* RENDER */
    _this.renderer = new THREE.WebGLRenderer({ antialias: true });
    _this.renderer.autoClear = false;
    //_this.renderer.setClearColor(0x000000, 0);
    //_this.renderer.shadowMap.enabled = true;
    _this.renderer.toneMapping = THREE.ReinhardToneMapping;
    _this.renderer.setPixelRatio(window.devicePixelRatio);
    _this.renderer.setSize(width, height);
    _this.container.appendChild(_this.renderer.domElement);

    addEventListeners();
  }

  function addEventListeners() {
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('keydown', onKeyDown, false);
  }

  function onWindowResize() {
    height = _this.container.offsetHeight;
    width = _this.container.offsetWidth;
    _this.camera.aspect = width / height;
    _this.camera.updateProjectionMatrix();

    _this.renderer.setSize(width, height);
  }

  // keyboard controls
  function onKeyDown(e) {
    var k = e.key.toLowerCase();
    var caught = true;

    if (e.ctrlKey) {
      if (e.shiftKey) {
        if (k=="z") _this.redo();
        else caught = false;
      }
      else {
        if (k=="i") _this.import();
        else if (k=="z") _this.undo();
        else if (k=="y") _this.redo();
        else caught = false;
      }
    }
    else {
      if (k=="f") _this.cameraToModel();
      else if (k=="c") _this.toggleCOM();
      else if (k=="w") _this.toggleWireframe();
      else if (k=="b") _this.toggleBuildVolume();
      else if (k=="g") _this.toggleGizmo();
      else if (e.keyCode === 27) _this.mDeactivate();
      else caught = false;
    }

    if (caught) e.preventDefault();
  }

  function animate() {
    requestAnimationFrame(animate);
    render();
  }

  function render() {
    if (!_this.camera || !_this.scene) return;
    _this.controls.update();
    if (_this.gizmo) {
      _this.gizmo.update(_this.position, _this.rotation, _this.scale);
    }
    _this.axisWidget.update();
    _this.infoBox.update();
    if (_this.model && _this.model.measurement) {
      _this.model.measurement.rescale();
    }
    _this.renderer.clear();
    _this.renderer.render(_this.scene, _this.camera);
    _this.renderer.clearDepth();
    _this.renderer.render(_this.gizmoScene, _this.camera);
  }
}

Stage.prototype.calculateBuildVolumeBounds = function() {
  var size = this.buildVolumeSize;
  var x0, x1;
  var y0, y1;
  var z0 = 0, z1 = size.z;

  if (this.centerOriginOnBuildPlate) {
    x0 = -size.x / 2, x1 = size.x / 2;
    y0 = -size.y / 2, y1 = size.y / 2;
  }
  else {
    x0 = 0, x1 = size.x;
    y0 = 0, y1 = size.y;
  }

  this.buildVolumeMin = new THREE.Vector3(x0, y0, z0);
  this.buildVolumeMax = new THREE.Vector3(x1, y1, z1);
}

Stage.prototype.calculateBuildVolumeCenter = function() {
  if (!this.buildVolumeMin || !this.buildVolumeMax) this.calculateBuildVolumeBounds();

  return this.buildVolumeMin.clone().add(this.buildVolumeMax).divideScalar(2);
}

Stage.prototype.calculateBuildPlateCenter = function() {
  return this.calculateBuildVolumeCenter().setZ(0);
}

Stage.prototype.defaultCameraCenter = function() {
  return this.calculateBuildVolumeCenter().setZ(this.buildVolumeSize.z/8);
}

// Create the build volume.
Stage.prototype.makeBuildVolume = function() {
  removeMeshByName(this.scene, "buildVolume");
  removeMeshByName(this.scene, "buildVolumePlane");

  this.calculateBuildVolumeBounds();
  var min = this.buildVolumeMin, max = this.buildVolumeMax;

  var x0 = min.x, x1 = max.x;
  var y0 = min.y, y1 = max.y;
  var z0 = min.z, z1 = max.z;

  // Primary: center line through origin
  // Secondary: lines along multiples of 5
  // Tertiary: everything else
  var geoPrimary = new THREE.Geometry();
  var geoSecondary = new THREE.Geometry();
  var geoTertiary = new THREE.Geometry();
  var geoFloor = new THREE.Geometry();
  var matPrimary = this.buildVolumeMaterials.linePrimary;
  var matSecondary = this.buildVolumeMaterials.lineSecondary;
  var matTertiary = this.buildVolumeMaterials.lineTertiary;
  var matFloor = this.buildVolumeMaterials.floorPlane;

  // draw grid
  for (var i = Math.floor(x0 + 1); i < x1; i++) {
    var geo = i === 0 ? geoPrimary : i%5 === 0 ? geoSecondary : geoTertiary;
    pushSegment(geo, i, y0, z0, i, y1, z0);
  }
  for (var i = Math.floor(y0 + 1); i < y1; i++) {
    var geo = i === 0 ? geoPrimary : i%5 === 0 ? geoSecondary : geoTertiary;
    pushSegment(geo, x0, i, z0, x1, i, z0);
  }

  // draw a box around the build volume
  pushSegment(geoPrimary, x0, y0, z0, x0, y1, z0);
  pushSegment(geoPrimary, x0, y0, z0, x1, y0, z0);
  pushSegment(geoPrimary, x0, y1, z0, x1, y1, z0);
  pushSegment(geoPrimary, x1, y0, z0, x1, y1, z0);

  // vertical box uses a less conspicuous material
  pushSegment(geoTertiary, x0, y0, z1, x0, y1, z1);
  pushSegment(geoTertiary, x0, y0, z1, x1, y0, z1);
  pushSegment(geoTertiary, x0, y1, z1, x1, y1, z1);
  pushSegment(geoTertiary, x1, y0, z1, x1, y1, z1);
  pushSegment(geoTertiary, x0, y0, z0, x0, y0, z1);
  pushSegment(geoTertiary, x0, y1, z0, x0, y1, z1);
  pushSegment(geoTertiary, x1, y0, z0, x1, y0, z1);
  pushSegment(geoTertiary, x1, y1, z0, x1, y1, z1);

  // draw floor plane
  /*geoFloor.vertices.push(new THREE.Vector3(x0, y0, z0));
  geoFloor.vertices.push(new THREE.Vector3(x0, y1, z0));
  geoFloor.vertices.push(new THREE.Vector3(x1, y1, z0));
  geoFloor.vertices.push(new THREE.Vector3(x1, y0, z0));
  geoFloor.faces.push(new THREE.Face3(0, 1, 2));
  geoFloor.faces.push(new THREE.Face3(0, 2, 3));*/

  var linePrimary = new THREE.LineSegments(geoPrimary, matPrimary);
  var lineSecondary = new THREE.LineSegments(geoSecondary, matSecondary);
  var lineTertiary = new THREE.LineSegments(geoTertiary, matTertiary);
  //var meshFloor = new THREE.Mesh(geoFloor, matFloor);
  linePrimary.name = "buildVolume";
  lineSecondary.name = "buildVolume";
  lineTertiary.name = "buildVolume";
  //meshFloor.name = "buildVolume";
  this.scene.add(linePrimary);
  this.scene.add(lineSecondary);
  this.scene.add(lineTertiary);
  //this.scene.add(meshFloor);

  this.setBuildVolumeState();

  function pushSegment(geo, x0, y0, z0, x1, y1, z1) {
    var vs = geo.vertices;
    vs.push(new THREE.Vector3(x0, y0, z0));
    vs.push(new THREE.Vector3(x1, y1, z1));
  }
}

// Interface for the dat.gui button.
Stage.prototype.import = function() {
  if (this.model) {
    this.printout.warn("A model is already loaded; delete the current model to import a new one.");
    return;
  }

  if (!this.importEnabled) {
    this.printout.warn("Already importing mesh " + this.importingMeshName);
    return;
  }

  if (this.fileInput) {
    this.fileInput.click();
  }
}

// Called from HTML when the import button is clicked. Creates the Model
// instance and tells it to load the geometry.
Stage.prototype.handleFile = function(file) {
  this.importingMeshName = file.name;
  this.importEnabled = false;

  var loader = new FileLoader();
  loader.load(file, this.createModel.bind(this));

  return;

  var model = new Model(
    this.scene,
    this.camera,
    this.container,
    this.printout,
    this.infoBox,
    this.progressBarContainer
  );

  var importParams = {
    unitsFrom: this.importUnits,
    unitsTo: this.units
  };

  model.isLittleEndian = this.isLittleEndian;
  model.vertexPrecision = this.vertexPrecision;
  model.import(file, importParams, this.displayMesh.bind(this));
};

Stage.prototype.createModel = function(geometry) {
  this.model = new Model(
    geometry,
    this.scene,
    this.camera,
    this.container,
    this.printout,
    this.infoBox,
    this.progressBarContainer
  );

  this.importEnabled = true;
  this.fileInput.value = "";
  this.importingMeshName = "";

  this.buildEditFolder();

  this.filename = this.model.filename;
  this.gcodeFilename = this.filename;
  this.gcodeFilenameController.updateDisplay();

  if (this.autocenterOnImport) this.autoCenter(false);
  else if (this.snapTransformationsToFloor) this.floor(false);

  this.cameraToModel();

  this.setMeshMaterial();
  this.updateUI();

  this.gizmo.visible = true;
}

// todo: deprecate
// Callback passed to model.import; puts the mesh into the viewport.
Stage.prototype.displayMesh = function(success, model) {
  this.importEnabled = true;

  if (!success) {
    // it's necessary to clear file input box because it blocks importing
    // a model with the same name twice in a row
    this.fileInput.value = "";

    this.importingMeshName = "";

    this.model = null;
    return;
  }

  // set model
  this.model = model;

  // failsafe
  if (!this.model) {
    removeMeshByName(this.scene, "model");
    return;
  }

  this.buildEditFolder();

  this.filename = this.model.filename;
  this.gcodeFilename = this.filename;
  this.gcodeFilenameController.updateDisplay();

  if (this.autocenterOnImport) this.autoCenter();

  // todo: remove
  //this.generateSupports();
  //this.activateSliceMode();
  //this.gcodeSave();

  this.cameraToModel();

  // todo: remove
  //this.currentSliceLevel = 39;
  //this.setSliceLevel();

  var ct = false ? new THREE.Vector3(9.281622759922609, 32.535200621303574, 1.0318610787252986) : null;
  if (ct) {
    this.controls.update({
      origin: ct,
      r: 0.01
    });
  }

  this.setMeshMaterial();
  this.updateUI();
}

// Interface for the dat.gui button. Saves the model.
Stage.prototype.export = function(format) {
  if (!this.model) {
    this.printout.warn("No model to export.");
    return;
  }

  this.model.export(format, this.filename);
}

// Interface for the dat.gui button. Completely removes the model and resets
// everything to a clean state.
Stage.prototype.delete = function() {
  // it's necessary to clear file input box because it blocks importing
  // a model with the same name twice in a row
  this.fileInput.value = "";

  this.deactivateSliceMode();

  this.mDeactivate();
  if (this.model) {
    this.model.dispose();
  }
  else {
    this.printout.warn("No model to delete.");
    return;
  }
  this.model = null;
  this.editStack.clear();
  this.clearFolder(this.editFolder);
  this.gizmo.visible = false;

  this.printout.log("Model deleted.");
}

// Reposition the camera to look at the model.
Stage.prototype.cameraToModel = function() {
  if (!this.model) {
    this.printout.warn("No model to align camera.");
    return;
  }
  this.controls.update({
    origin: this.model.getCenter(),
    r: this.model.getMaxSize() * 3 // factor of 3 empirically determined
  });
}
