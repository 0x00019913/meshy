/* stage.js

   classes:

   - Stage
   description:
    Main class representing the Meshy viewport. Encompasses UI, creating and
    handling the model, and controlling the viewport.
*/

// Constructor.
Stage = function() {
  this.units = Units.mm;

  // params
  this.buildVolumeSize = new THREE.Vector3(145, 145, 175);
  this.buildVolumeMin = null;
  this.buildVolumeMax = null;
  this.centerOriginOnBuildPlate = false;
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
  this.autocenterOnImport = true;

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
  this.printout.log("Controls: LMB (turn), MMB (pan/zoom), RMB (pan), F (center on model), C (center of mass), W (wireframe), B (build volume)");

  // undo stack
  this.undoStack = new UndoStack(this.printout);

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
    .title("Export as ASCII STL file");

  var settingsFolder = this.gui.addFolder("Settings", "Settings for computation.");

  settingsFolder.add(this, "isLittleEndian").name("Little endian")
    .title("Endianness toggle for imports and exports.");
  settingsFolder.add(this, "vertexPrecision").name("Vertex precision").onChange(this.setVertexPrecision.bind(this))
    .title("Precision p; 10^p is used as a conversion factor between floating-point and fixed-point coordinates.");

  var displayFolder = this.gui.addFolder("Display", "Mesh and build volume display settings.");

  displayFolder.add(this, "toggleAxisWidget").name("Toggle axis widget")
    .title("Toggle axis widget visibility.");
  displayFolder.add(this, "toggleWireframe").name("Toggle wireframe")
    .title("Toggle mesh wireframe.");
  displayFolder.add(this, "cameraToModel").name("Camera to model")
    .title("Snap camera to model.");
  this.backgroundColor = "#222222";
  this.meshColor = "#662828"; // todo: reset to 0xffffff
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

  var editFolder = this.gui.addFolder("Edit", "Mesh edit functions: translation, scaling, rotation, normals.");

  editFolder.add(this, "autoCenter").name("Autocenter")
    .title("Center the mesh on x and y; snap to the floor on z.");

  var translateFolder = editFolder.addFolder("Translate");
  this.xTranslation = 0;
  translateFolder.add(this, "xTranslation").name("x translation");
  translateFolder.add(this, "translateX").name("Translate on x");
  this.yTranslation = 0;
  translateFolder.add(this, "yTranslation").name("y translation");
  translateFolder.add(this, "translateY").name("Translate on y");
  this.zTranslation = 0;
  translateFolder.add(this, "zTranslation").name("z translation");
  translateFolder.add(this, "translateZ").name("Translate on z");

  var rotateFolder = editFolder.addFolder("Rotate");
  this.xRotation = 0;
  rotateFolder.add(this, "xRotation").name("x rotation");
  rotateFolder.add(this, "rotateX").name("Rotate about x");
  this.yRotation = 0;
  rotateFolder.add(this, "yRotation").name("y rotation");
  rotateFolder.add(this, "rotateY").name("Rotate about y");
  this.zRotation = 0;
  rotateFolder.add(this, "zRotation").name("z rotation");
  rotateFolder.add(this, "rotateZ").name("Rotate about z");

  var scaleFolder = editFolder.addFolder("Scale");

  var scaleByFactorFolder = scaleFolder.addFolder("Scale By Factor");
  this.xScale = 1;
  scaleByFactorFolder.add(this, "xScale", 0).name("x scale");
  scaleByFactorFolder.add(this, "scaleX").name("Scale on x");
  this.yScale = 1;
  scaleByFactorFolder.add(this, "yScale", 0).name("y scale");
  scaleByFactorFolder.add(this, "scaleY").name("Scale on y");
  this.zScale = 1;
  scaleByFactorFolder.add(this, "zScale", 0).name("z scale");
  scaleByFactorFolder.add(this, "scaleZ").name("Scale on z");
  this.allScale = 1;
  scaleByFactorFolder.add(this, "allScale", 0).name("all scale");
  scaleByFactorFolder.add(this, "scaleAll").name("Scale on all axes");

  var scaleToSizeFolder = scaleFolder.addFolder("Scale To Size");
  this.scaleOnAllAxes = true;
  scaleToSizeFolder.add(this, "scaleOnAllAxes").name("Scale on all axes");
  this.newXSize = 1;
  scaleToSizeFolder.add(this, "newXSize", 0).name("New x size");
  scaleToSizeFolder.add(this, "scaleToXSize").name("Scale to x size");
  this.newYSize = 1;
  scaleToSizeFolder.add(this, "newYSize", 0).name("New y size");
  scaleToSizeFolder.add(this, "scaleToYSize").name("Scale to y size");
  this.newZSize = 1;
  scaleToSizeFolder.add(this, "newZSize", 0).name("New z size");
  scaleToSizeFolder.add(this, "scaleToZSize").name("Scale to z size");

  this.scaleToMeasurementFolder = scaleFolder.addFolder("Scale To Measurement");

  var ringSizeFolder = scaleFolder.addFolder("Scale To Ring Size");
  ringSizeFolder.add(this, "mCircle").name("Mark circle");
  this.newRingSize = 0;
  ringSizeFolder.add(this, "newRingSize", ringSizes).name("New ring size");
  ringSizeFolder.add(this, "scaleToRingSize").name("Scale to ring size");
  ringSizeFolder.add(this, "mDeactivate").name("End measurement");

  var mirrorFolder = editFolder.addFolder("Mirror");
  mirrorFolder.add(this, "mirrorX").name("Mirror on x");
  mirrorFolder.add(this, "mirrorY").name("Mirror on y");
  mirrorFolder.add(this, "mirrorZ").name("Mirror on z");

  var floorFolder = editFolder.addFolder("Floor");
  floorFolder.add(this, "floorX").name("Floor to x");
  floorFolder.add(this, "floorY").name("Floor to y");
  floorFolder.add(this, "floorZ").name("Floor to z");

  var centerFolder = editFolder.addFolder("Center");
  centerFolder.add(this, "centerAll").name("Center on all");
  centerFolder.add(this, "centerX").name("Center on x");
  centerFolder.add(this, "centerY").name("Center on y");
  centerFolder.add(this, "centerZ").name("Center on z");

  editFolder.add(this, "flipNormals").name("Flip normals");

  var calculationFolder = this.gui.addFolder("Calculate");
  calculationFolder.add(this, "calcSurfaceArea").name("Surface area");
  calculationFolder.add(this, "calcVolume").name("Volume");
  calculationFolder.add(this, "calcCenterOfMass").name("Center of mass");
  calculationFolder.add(this, "toggleCOM").name("Toggle COM");

  var measurementFolder = this.gui.addFolder("Measure");
  measurementFolder.add(this, "mLength").name("Length");
  measurementFolder.add(this, "mAngle").name("Angle");
  measurementFolder.add(this, "mCircle").name("Circle");
  measurementFolder.add(this, "mCrossSectionX").name("Cross-section x");
  measurementFolder.add(this, "mCrossSectionY").name("Cross-section y");
  measurementFolder.add(this, "mCrossSectionZ").name("Cross-section z");
  measurementFolder.add(this, "mDeactivate").name("End measurement");

  var thicknessFolder = this.gui.addFolder("Mesh Thickness");
  this.thicknessThreshold = 0.1;
  thicknessFolder.add(this, "thicknessThreshold", 0).name("Threshold");
  thicknessFolder.add(this, "viewThickness").name("View thickness");
  thicknessFolder.add(this, "clearThicknessView").name("Clear thickness view");

  var repairFolder = this.gui.addFolder("Repair (beta)");
  repairFolder.add(this, "generatePatch").name("Generate patch");
  repairFolder.add(this, "acceptPatch").name("Accept patch");
  repairFolder.add(this, "cancelPatch").name("Cancel patch");

  this.layerHeight = .05;//todo: back to 0.1
  this.lineWidth = 0.05;
  this.upAxis = "z";
  this.supportSliceFolder = this.gui.addFolder("Supports & Slicing (beta)");
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
  this.sliceNumTopLayers = 3;
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
  this.gcodePrintSpeed = 70;
  this.gcodeRaftBasePrintSpeed = 25;
  this.gcodeRaftTopPrintSpeed = 30;
  this.buildSupportSliceFolder();

  this.gui.add(this, "undo").name("Undo");
  this.gui.add(this, "redo").name("Redo");
  this.gui.add(this, "delete").name("Delete");

  this.infoBox = new InfoBox();
  this.infoBox.add("Units", this, "units");
  this.infoBox.add("Polycount", this, ["model","count"]);
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
}

// anything that needs to be refreshed by hand (not in every frame)
Stage.prototype.updateUI = function() {
  this.filenameController.updateDisplay();
}

// used for internal optimization while building a list of unique vertices
Stage.prototype.setVertexPrecision = function() {
  if (this.model) this.model.setVertexPrecision(this.vertexPrecision);
}

// Set up an arbitrary transform, create its inverse and push it onto the
// undo stack, apply the transform.
Stage.prototype.transform = function(op, axis, amount) {
  this.deactivateSliceMode();
  var transform = new Transform(op, axis, amount, this.model, this.printout);
  var inv = transform.makeInverse();
  if (inv) this.undoStack.push(transform, inv);
  transform.apply();
}

// Functions corresponding to buttons in the dat.gui.
Stage.prototype.exportOBJ = function() { this.export("obj"); }
Stage.prototype.exportSTL = function() { this.export("stl"); }
Stage.prototype.exportSTLascii = function() { this.export("stlascii"); }

Stage.prototype.undo = function() {
  this.deactivateSliceMode();
  this.undoStack.undo();
}
Stage.prototype.redo = function() {
  this.deactivateSliceMode();
  this.undoStack.redo();
}

Stage.prototype.autoCenter = function() {
  var model = this.model;
  if (!model) return;

  var d = this.calculateBuildPlateCenter().sub(model.getCenter()).setZ(-model.min.z);
  this.transform("translate","all",d);
}
Stage.prototype.translateX = function() { this.transform("translate","x",this.xTranslation); }
Stage.prototype.translateY = function() { this.transform("translate","y",this.yTranslation); }
Stage.prototype.translateZ = function() { this.transform("translate","z",this.zTranslation); }
Stage.prototype.rotateX = function() { this.transform("rotate","x",this.xRotation); }
Stage.prototype.rotateY = function() { this.transform("rotate","y",this.yRotation); }
Stage.prototype.rotateZ = function() { this.transform("rotate","z",this.zRotation); }
Stage.prototype.scaleX = function() { this.transform("scale","x",this.xScale); }
Stage.prototype.scaleY = function() { this.transform("scale","y",this.yScale); }
Stage.prototype.scaleZ = function() { this.transform("scale","z",this.zScale); }
Stage.prototype.scaleAll = function() { this.transform("scale","all",this.allScale); }
Stage.prototype.scaleToXSize = function() { this.scaleToSize("x",this.newXSize); }
Stage.prototype.scaleToYSize = function() { this.scaleToSize("y",this.newYSize); }
Stage.prototype.scaleToZSize = function() { this.scaleToSize("z",this.newZSize); }
Stage.prototype.scaleToSize = function(axis, value) {
  if (this.model) {
    var currentSize = this.model["getSize"+axis]();
    if (currentSize>0) {
      var ratio = value/currentSize;
      if (this.scaleOnAllAxes) this.transform("scale","all",ratio);
      else this.transform("scale",axis,ratio);
    }
    else {
      this.printout.error("Couldn't get current model size, try again or reload the model.");
    }
  }
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
Stage.prototype.mirrorX = function() { this.transform("mirror","x",null); }
Stage.prototype.mirrorY = function() { this.transform("mirror","y",null); }
Stage.prototype.mirrorZ = function() { this.transform("mirror","z",null); }
Stage.prototype.floorX = function() { this.transform("floor","x",null); }
Stage.prototype.floorY = function() { this.transform("floor","y",null); }
Stage.prototype.floorZ = function() { this.transform("floor","z",null); }
Stage.prototype.centerAll = function() { this.transform("center","all",null); }
Stage.prototype.centerX = function() { this.transform("center","x",null); }
Stage.prototype.centerY = function() { this.transform("center","y",null); }
Stage.prototype.centerZ = function() { this.transform("center","z",null); }
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
  this.clearFolder(this.scaleToMeasurementFolder);
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
    supportSliceFolder.add(this, "layerHeight", .0001, 1).name("Layer height");
    supportSliceFolder.add(this, "lineWidth", .0001, 1).name("Line width");
    supportSliceFolder.add(this, "upAxis", ["x", "y", "z"]).name("Up axis");

    var supportFolder = supportSliceFolder.addFolder("Supports");
    this.buildSupportFolder(supportFolder);

    var sliceFolder = supportSliceFolder.addFolder("Slice");
    this.buildSliceFolder(sliceFolder);
  }
}
Stage.prototype.buildSupportFolder = function(folder) {
  folder.add(this, "supportAngle", 0, 90).name("Angle");
  folder.add(this, "supportSpacingFactor", 1, 100).name("Spacing factor");
  folder.add(this, "supportRadius", 0.0001, 1).name("Radius");
  folder.add(this, "supportTaperFactor", 0, 1).name("Taper factor");
  folder.add(this, "supportSubdivs", 4).name("Subdivs");
  folder.add(this, "supportRadiusFnName", ["constant", "sqrt"]).name("Radius function");
  folder.add(this, "supportRadiusFnK", 0, 1).name("Function constant");
  folder.add(this, "generateSupports").name("Generate supports");
  folder.add(this, "removeSupports").name("Remove supports");
}
Stage.prototype.buildSliceDisplayFolder = function(folder) {
  this.clearFolder(folder);

  if (this.sliceMode === Slicer.Modes.preview) {
    folder.add(this, "slicePreviewModeSliceMesh", true).name("Show sliced mesh")
      .onChange(this.updateSlicerDisplayParams.bind(this));
  }
  else if (this.sliceMode === Slicer.Modes.full) {
    folder.add(this, "sliceFullModeUpToLayer").name("Up to layer")
      .onChange(this.updateSlicerDisplayParams.bind(this));
    folder.add(this, "sliceFullModeShowInfill").name("Show infill")
      .onChange(this.updateSlicerDisplayParams.bind(this));
  }
}
Stage.prototype.buildSliceFolder = function(folder) {
  this.clearFolder(folder);

  if (this.sliceModeOn) {
    var maxLevel = this.model.getMaxLevel();
    var minLevel = this.model.getMinLevel();

    this.currentSliceLevel = this.model.getCurrentSliceLevel();
    var sliceController = folder.add(
      this,
      "currentSliceLevel",
      minLevel, maxLevel
    ).name("Slice").step(1).onChange(this.setSliceLevel.bind(this));
    this.sliceMode = this.model.getSliceMode();
    folder.add(
      this,
      "sliceMode",
      { "preview": Slicer.Modes.preview, "full": Slicer.Modes.full }
    ).name("Mode").onChange(this.setSliceMode.bind(this));

    this.sliceDisplayFolder = folder.addFolder("Display");
    this.buildSliceDisplayFolder(this.sliceDisplayFolder);
  }
  this.buildLayerSettingsFolder(folder);
  this.buildRaftFolder(folder);
  this.buildGcodeFolder(folder);

  if (this.sliceModeOn) folder.add(this, "deactivateSliceMode").name("Slice mode off")
  else folder.add(this, "activateSliceMode").name("Slice mode on");
}
Stage.prototype.buildLayerSettingsFolder = function(folder) {
  var sliceLayerSettingsFolder = folder.addFolder("Layer Settings");
  this.clearFolder(sliceLayerSettingsFolder);

  sliceLayerSettingsFolder.add(this, "sliceNumWalls", 1, 10).name("Walls").step(1);
  sliceLayerSettingsFolder.add(this, "sliceNumTopLayers", 1, 10).name("Top layers").step(1);
  sliceLayerSettingsFolder.add(this, "sliceInfillType", {
    "none": Slicer.InfillTypes.none,
    "solid": Slicer.InfillTypes.solid,
    "grid": Slicer.InfillTypes.grid,
    "lines": Slicer.InfillTypes.lines,
    //"triangle": Slicer.InfillTypes.triangle,
    //"hex": Slicer.InfillTypes.hex
  }).name("Infill Type");
  sliceLayerSettingsFolder.add(this, "sliceInfillDensity", 0, 1).name("Infill Density");
  sliceLayerSettingsFolder.add(this, "sliceInfillOverlap", 0, 1).name("Infill Overlap");
  if (this.sliceModeOn) {
    sliceLayerSettingsFolder.add(this, "updateSlicerParams").name("Update params");
  }
}
Stage.prototype.buildRaftFolder = function(folder) {
  var sliceRaftFolder = folder.addFolder("Raft");
  this.clearFolder(sliceRaftFolder);

  sliceRaftFolder.add(this, "sliceMakeRaft").name("Make raft");
  sliceRaftFolder.add(this, "sliceRaftNumTopLayers", 0).step(1).name("Top layers");
  sliceRaftFolder.add(this, "sliceRaftTopLayerHeight", 0).name("Top height");
  sliceRaftFolder.add(this, "sliceRaftTopLineWidth", 0).name("Top width");
  sliceRaftFolder.add(this, "sliceRaftTopDensity", 0, 1).name("Top density");
  sliceRaftFolder.add(this, "sliceRaftNumBaseLayers", 0).step(1).name("Base layers");
  sliceRaftFolder.add(this, "sliceRaftBaseLayerHeight", 0).name("Base height");
  sliceRaftFolder.add(this, "sliceRaftBaseLineWidth", 0).name("Base width");
  sliceRaftFolder.add(this, "sliceRaftBaseDensity", 0, 1).name("Base density");
  sliceRaftFolder.add(this, "sliceRaftOffset", 0).name("Offset");
  sliceRaftFolder.add(this, "sliceRaftGap", 0).name("Air gap");
  sliceRaftFolder.add(this, "sliceRaftWriteWalls").name("Write perimeter");
  if (this.sliceModeOn) {
    sliceRaftFolder.add(this, "updateSlicerParams").name("Update params");
  }
}
Stage.prototype.buildGcodeFolder = function(folder) {
  var gcodeFolder = folder.addFolder("G-code");
  this.clearFolder(gcodeFolder);

  gcodeFolder.add(this, "gcodeFilename").name("Filename");
  gcodeFolder.add(this, "gcodeExtension", { gcode: "gcode" }).name("Extension");
  gcodeFolder.add(this, "gcodeTemperature", 0).name("Temperature");
  gcodeFolder.add(this, "gcodeFilamentDiameter", 0.1, 5).name("Filament diameter");
  gcodeFolder.add(this, "gcodePrintSpeed", 0).name("Print speed");
  gcodeFolder.add(this, "gcodeRaftBasePrintSpeed", 0).name("Raft base speed");
  gcodeFolder.add(this, "gcodeRaftTopPrintSpeed", 0).name("Raft top speed");
  if (this.sliceModeOn) {
    gcodeFolder.add(this, "gcodeSave", 0).name("Save G-code");
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
  // todo
}
Stage.prototype.buildScaleToMeasurementFolder = function() {
  this.clearFolder(this.scaleToMeasurementFolder);
  if (this.model) this.scalableMeasurements = this.model.getScalableMeasurements();
  if (this.scalableMeasurements && this.scalableMeasurements.length>0) {
    this.measurementToScale = this.scalableMeasurements[0];
    this.newMeasurementValue = 1;
    this.scaleToMeasurementFolder.add(this, "measurementToScale", this.scalableMeasurements).name("Measurement to scale");
    this.scaleToMeasurementFolder.add(this, "newMeasurementValue", 0).name("New value");
    this.scaleToMeasurementFolder.add(this, "scaleToMeasurement").name("Scale to measurement");
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
    debug = new Debug(_this.scene); // todo: remove
    _this.scene.background = new THREE.Color(_this.backgroundColor);

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

    var pointLight = new THREE.PointLight(0xffffff, 3);
    _this.scene.add(pointLight);
    _this.controls.addObject(pointLight);
    var ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    _this.scene.add(ambientLight);

    _this.axisWidget = new AxisWidget(_this.camera);

    _this.controls.update();

    /* RENDER */
    _this.renderer = new THREE.WebGLRenderer({ antialias: true });
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

    if (e.ctrlKey) {
      if (e.shiftKey) {
        if (k=="z") _this.redo();
      }
      else {
        if (k=="i") _this.import();
        if (k=="z") _this.undo();
        if (k=="y") _this.redo();
      }
    }
    else {
      if (k=="f") _this.cameraToModel();
      else if (k=="c") _this.toggleCOM();
      else if (k=="w") _this.toggleWireframe();
      else if (k=="b") _this.toggleBuildVolume();
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    render();
  }

  function render() {
    if (!_this.camera || !_this.scene) return;
    _this.controls.update();
    _this.axisWidget.update();
    _this.infoBox.update();
    if (_this.model && _this.model.measurement) {
      _this.model.measurement.rescale();
    }
    _this.renderer.render(_this.scene, _this.camera);
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

// Callback passed to model.import; puts the mesh into the viewport.
Stage.prototype.displayMesh = function(success, model) {
  this.importEnabled = true;

  if (!success) {
    // it's necessary to clear file input box because it blocks importing
    // a model with the same name twice in a row
    this.fileInput.value = "";

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

  if (this.autocenterOnImport) this.autoCenter();

  // todo: remove
  //this.generateSupports();
  this.activateSliceMode();

  this.cameraToModel();

  // todo: remove
  //this.currentSliceLevel = -1;//135;
  //this.setSliceLevel();

  var ct = false ? new THREE.Vector3(9.281622759922609, 32.535200621303574, 1.0318610787252986) : null;
  if (ct) {
    this.controls.update({
      origin: ct,
      r: 0.01
    });
  }

  this.filename = this.model.filename;
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
  this.undoStack.clear();

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
