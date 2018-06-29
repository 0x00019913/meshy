/* stage.js

   classes:

   - Stage
   description:
    Main class representing the Meshy viewport. Encompasses UI, creating and
    handling the model, and controlling the viewport.
*/

// Constructor.
Stage = function() {
  // params
  this.buildVolumeSize = new THREE.Vector3(145, 145, 175);

  // toggles
  this.importEnabled = true;
  this.importingMeshName = "";
  this.buildVolumeVisible = true;

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
  this.printout.log("Controls: LMB (turn), MMB (pan/zoom), RMB (pan), F (center on model), C (center of mass), W (wireframe)");

  // undo stack
  this.undoStack = new UndoStack(this.printout);

  // UI
  this.generateUI();
}

// Creates the dat.gui element and the InfoBox, initializes the viewport,
// initializes build volume.
Stage.prototype.generateUI = function() {
  this.gui = new dat.GUI();
  this.gui.add(this, "import").name("Import");

  var exportFolder = this.gui.addFolder("Export");
  this.filename = "meshy";
  this.filenameController = exportFolder.add(this, "filename").name("Filename");
  exportFolder.add(this, "exportOBJ").name("Export OBJ");
  exportFolder.add(this, "exportSTL").name("Export STL");
  exportFolder.add(this, "exportSTLascii").name("Export ASCII STL");

  var settingsFolder = this.gui.addFolder("Settings");

  settingsFolder.add(this, "isLittleEndian").name("Little endian");
  settingsFolder.add(this, "vertexPrecision").name("Vertex precision").onChange(this.setVertexPrecision.bind(this));

  var displayFolder = this.gui.addFolder("Display");
  displayFolder.add(this, "toggleBuildVolume").name("Toggle build volume");
  displayFolder.add(this, "toggleAxisWidget").name("Toggle axis widget");
  displayFolder.add(this, "toggleCOM").name("Toggle center of mass");
  displayFolder.add(this, "toggleWireframe").name("Toggle wireframe");
  displayFolder.add(this, "cameraToModel").name("Camera to model");
  this.meshColor = "#662828"; // todo: reset to 0xffffff
  this.meshRoughness = 0.3;
  this.meshMetalness = 0.5;
  this.meshColorController =
    displayFolder.addColor(this, "meshColor").name("Mesh color").onChange(this.setMeshMaterial.bind(this));
  displayFolder.add(this, "meshRoughness", 0, 1).onChange(this.setMeshMaterial.bind(this));
  displayFolder.add(this, "meshMetalness", 0, 1).onChange(this.setMeshMaterial.bind(this));
  displayFolder.add(this.buildVolumeSize, "x", 0).name("Build volume x")
    .onChange(this.makeBuildVolume.bind(this));
  displayFolder.add(this.buildVolumeSize, "y", 0).name("Build volume y")
    .onChange(this.makeBuildVolume.bind(this));
  displayFolder.add(this.buildVolumeSize, "z", 0).name("Build volume z")
    .onChange(this.makeBuildVolume.bind(this));

  var transformFolder = this.gui.addFolder("Transform");

  transformFolder.add(this, "autoCenter").name("Autocenter");

  var translateFolder = transformFolder.addFolder("Translate");
  this.xTranslation = 0;
  translateFolder.add(this, "xTranslation").name("x translation");
  translateFolder.add(this, "translateX").name("Translate on x");
  this.yTranslation = 0;
  translateFolder.add(this, "yTranslation").name("y translation");
  translateFolder.add(this, "translateY").name("Translate on y");
  this.zTranslation = 0;
  translateFolder.add(this, "zTranslation").name("z translation");
  translateFolder.add(this, "translateZ").name("Translate on z");

  var rotateFolder = transformFolder.addFolder("Rotate");
  this.xRotation = 0;
  rotateFolder.add(this, "xRotation").name("x rotation");
  rotateFolder.add(this, "rotateX").name("Rotate about x");
  this.yRotation = 0;
  rotateFolder.add(this, "yRotation").name("y rotation");
  rotateFolder.add(this, "rotateY").name("Rotate about y");
  this.zRotation = 0;
  rotateFolder.add(this, "zRotation").name("z rotation");
  rotateFolder.add(this, "rotateZ").name("Rotate about z");

  var scaleFolder = transformFolder.addFolder("Scale");

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

  var mirrorFolder = transformFolder.addFolder("Mirror");
  mirrorFolder.add(this, "mirrorX").name("Mirror on x");
  mirrorFolder.add(this, "mirrorY").name("Mirror on y");
  mirrorFolder.add(this, "mirrorZ").name("Mirror on z");

  var floorFolder = transformFolder.addFolder("Floor");
  floorFolder.add(this, "floorX").name("Floor to x");
  floorFolder.add(this, "floorY").name("Floor to y");
  floorFolder.add(this, "floorZ").name("Floor to z");

  var centerFolder = transformFolder.addFolder("Center");
  centerFolder.add(this, "centerAll").name("Center on all");
  centerFolder.add(this, "centerX").name("Center on x");
  centerFolder.add(this, "centerY").name("Center on y");
  centerFolder.add(this, "centerZ").name("Center on z");

  transformFolder.add(this, "flipNormals").name("Flip normals");

  var calculationFolder = this.gui.addFolder("Calculate");
  calculationFolder.add(this, "calcSurfaceArea").name("Surface area");
  calculationFolder.add(this, "calcVolume").name("Volume");
  calculationFolder.add(this, "calcCenterOfMass").name("Center of mass");

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

  this.verticalResolution = .05;//todo: back to 0.1
  this.planarResolution = 0.05;
  this.upAxis = "z";
  this.supportSliceFolder = this.gui.addFolder("Supports & Slicing (beta)");
  this.supportAngle = 45;
  this.supportSpacingFactor = 6;
  this.supportRadius = this.planarResolution * 2;
  this.supportTaperFactor = 0.5;
  this.supportSubdivs = 16;
  // can't set support radius fn directly from dat.gui because it returns the
  // function stringified, so just set index and then convert it to the fn
  this.supportRadiusFnMap = {
    constant: SupportGenerator.RadiusFunctions.constant,
    sqrt: SupportGenerator.RadiusFunctions.sqrt
  };
  this.supportRadiusFnName = "sqrt";
  this.supportRadiusFnK = 0.01;
  this.sliceNumWalls = 2;
  this.sliceInfillType = Slicer.InfillTypes.grid; // todo: back to solid
  this.sliceInfillDensity = 0.1;
  this.sliceMakeRaft = false; // todo: back to true
  this.sliceRaftMainLayers = 3;
  this.sliceRaftBaseLayers = 1;
  this.sliceRaftOffset = 1;
  this.sliceRaftGap = 0.05;
  this.sliceRaftBaseSpacing = 0.1;
  this.buildSupportSliceFolderInactive();

  this.gui.add(this, "undo").name("Undo");
  this.gui.add(this, "redo").name("Redo");
  this.gui.add(this, "delete").name("Delete");

  this.infoBox = new InfoBox();
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

Stage.prototype.autoCenter = function() { this.transform("autoCenter","z",null); }
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
    if (this.supportRadius < this.planarResolution) {
      this.printout.warn("Support radius is lower than the planar resolution.");
    }

    this.model.generateSupports({
      angle: this.supportAngle,
      resolution: this.planarResolution * this.supportSpacingFactor,
      layerHeight: this.verticalResolution,
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
// build support & slicing folder when slice mode is off
Stage.prototype.buildSupportSliceFolderInactive = function() {
  this.clearFolder(this.supportSliceFolder);
  this.supportSliceFolder.add(this, "verticalResolution", .0001, 1).name("Vertical resolution");
  this.supportSliceFolder.add(this, "planarResolution", .0001, 1).name("Planar resolution");
  this.supportSliceFolder.add(this, "upAxis", ["x", "y", "z"]).name("Up axis");
  this.supportFolder = this.supportSliceFolder.addFolder("Supports");
  this.buildSupportFolder();
  this.sliceFolder = this.supportSliceFolder.addFolder("Slice");
  this.buildSliceFolderInactive();
}
Stage.prototype.buildSupportFolder = function() {
  this.supportFolder.add(this, "supportAngle", 0, 90).name("Angle");
  this.supportFolder.add(this, "supportSpacingFactor", 1, 20).name("Spacing factor");
  this.supportFolder.add(this, "supportRadius", 0.0001, 1).name("Radius");
  this.supportFolder.add(this, "supportTaperFactor", 0, 1).name("Taper factor");
  this.supportFolder.add(this, "supportSubdivs", 4).name("Subdivs");
  this.supportFolder.add(this, "supportRadiusFnName", ["constant", "sqrt"]).name("Radius function");
  this.supportFolder.add(this, "supportRadiusFnK", 0, 1).name("Function constant");
  this.supportFolder.add(this, "generateSupports").name("Generate supports");
  this.supportFolder.add(this, "removeSupports").name("Remove supports");
}
// build the Slice folder for when slice mode is off
Stage.prototype.buildSliceFolderInactive = function() {
  this.clearFolder(this.sliceFolder);
  this.addLayerSettingsFolder(this.sliceFolder);
  this.addRaftFolder(this.sliceFolder);
  this.sliceFolder.add(this, "activateSliceMode").name("Slice mode on");
}
// build the Slice folder for when slice mode is on
// NB: the resulting elements go under the Supports & Slicing folder b/c
// supports can't be generated nor removed while slice mode is on
Stage.prototype.buildSliceFolderActive = function() {
  if (!this.model) return;

  var numLayers = this.model.getNumLayers();
  if (numLayers !== 0) {
    var folder = this.supportSliceFolder;
    this.clearFolder(this.supportSliceFolder);
    this.currentLevel = this.model.getCurrentLevel();
    this.sliceController = folder.add(
      this,
      "currentLevel",
      0, numLayers
    ).name("Slice").step(1).onChange(this.setLevel.bind(this));
    this.sliceMode = this.model.getSliceMode();
    folder.add(
      this,
      "sliceMode",
      { "preview": Slicer.Modes.preview, "path": Slicer.Modes.path }
    ).name("Mode").onChange(this.setSliceMode.bind(this));

    this.addLayerSettingsFolder(folder, true);
    this.addRaftFolder(folder);
  }

  this.supportSliceFolder.add(this, "deactivateSliceMode").name("Slice mode off");
}
Stage.prototype.addLayerSettingsFolder = function(folder, showRecalculateButton) {
  this.sliceLayerSettingsFolder = folder.addFolder("Layer Settings");
  this.clearFolder(this.sliceLayerSettingsFolder);

  this.sliceLayerSettingsFolder.add(this, "sliceNumWalls", 1).name("Number of walls").step(1);
  this.sliceLayerSettingsFolder.add(this, "sliceInfillType", {
    "none": Slicer.InfillTypes.none,
    "solid": Slicer.InfillTypes.solid,
    "grid": Slicer.InfillTypes.grid,
    "triangle": Slicer.InfillTypes.triangle,
    "hex": Slicer.InfillTypes.hex
  }).name("Infill Type");
  this.sliceLayerSettingsFolder.add(this, "sliceInfillDensity", 0, 1).name("Infill Density");
  if (showRecalculateButton) {
    this.sliceLayerSettingsFolder.add(this, "recalculateLayers").name("Recalculate layers");
  }
}
Stage.prototype.addRaftFolder = function(folder) {
  this.sliceRaftFolder = folder.addFolder("Raft");
  this.clearFolder(this.sliceRaftFolder);

  this.sliceRaftFolder.add(this, "sliceMakeRaft").name("Make raft");
  this.sliceRaftFolder.add(this, "sliceRaftMainLayers", 0).step(1).name("Main layers");
  this.sliceRaftFolder.add(this, "sliceRaftBaseLayers", 0).step(1).name("Base layers");
  this.sliceRaftFolder.add(this, "sliceRaftOffset", 0).name("Offset");
  this.sliceRaftFolder.add(this, "sliceRaftGap", 0).name("Air gap");
  this.sliceRaftFolder.add(this, "sliceRaftBaseSpacing", 0, 1).name("Base spacing");
}
Stage.prototype.setSliceMode = function() {
  if (this.model) this.model.setSliceMode(this.sliceMode);
}
Stage.prototype.activateSliceMode = function() {
  if (this.model) {
    this.model.activateSliceMode({
      axis: this.upAxis,
      sliceHeight: this.verticalResolution,
      resolution: this.planarResolution,
      numWalls: this.sliceNumWalls,
      infillType: parseInt(this.sliceInfillType),
      infillDensity: this.sliceInfillDensity,
      makeRaft: this.sliceMakeRaft,
      raftMainLayers: this.sliceRaftMainLayers,
      raftBaseLayers: this.sliceRaftBaseLayers,
      raftOffset: this.sliceRaftOffset,
      raftGap: this.sliceRaftGap,
      raftBaseSpacing: this.sliceRaftBaseSpacing,
      precision: this.vertexPrecision
    });
    this.buildSliceFolderActive();
  }
}
Stage.prototype.deactivateSliceMode = function() {
  if (this.model) {
    this.buildSupportSliceFolderInactive();
    this.model.deactivateSliceMode();
  }
}
Stage.prototype.setLevel = function() {
  if (this.model) {
    this.model.setLevel(this.currentLevel);
  }
}
Stage.prototype.recalculateLayers = function() {
  if (this.model) {
    this.model.recalculateLayers(this.planarResolution, this.sliceNumWalls);
  }
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
    _this.scene.background = new THREE.Color(0x222222);

    _this.controls = new Controls(
      _this.camera,
      _this.container,
      {
        r: _this.buildVolumeSize.length() * 1,
        phi: 0,
        theta: 5*Math.PI/12,
        origin: new THREE.Vector3(0, 0, _this.buildVolumeSize.z / 8)
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

// Create the build volume.
Stage.prototype.makeBuildVolume = function() {
  removeMeshByName(this.scene, "buildVolume");

  var size = this.buildVolumeSize;
  var x = size.x / 2;
  var y = size.y / 2;
  var z = size.z;

  // Primary: center line through origin
  // Secondary: lines along multiples of 5
  // Tertiary: everything else
  var geoPrimary = new THREE.Geometry();
  var matPrimary = new THREE.LineBasicMaterial({
    color: 0xdddddd,
    linewidth: 1
  });
  var geoSecondary = new THREE.Geometry();
  var matSecondary = new THREE.LineBasicMaterial({
    color: 0x777777,
    linewidth: 1
  });
  var geoTertiary = new THREE.Geometry();
  var matTertiary = new THREE.LineBasicMaterial({
    color: 0x444444,
    linewidth: 1
  });

  // draw primary axes
  pushSegment(geoPrimary, 0, -y, 0, 0, y, 0);
  pushSegment(geoPrimary, -x, 0, 0, x, 0, 0);

  // draw grid
  for (var i = 1; i < x; i++) {
    if (i%5==0) {
      pushSegment(geoSecondary, i, -y, 0, i, y, 0);
      pushSegment(geoSecondary, -i, -y, 0, -i, y, 0);
    }
    else {
      pushSegment(geoTertiary, i, -y, 0, i, y, 0);
      pushSegment(geoTertiary, -i, -y, 0, -i, y, 0);
    }
  }
  for (var i = 1; i < y; i++) {
    if (i==0) continue;
    if (i%5==0) {
      pushSegment(geoSecondary, -x, i, 0, x, i, 0);
      pushSegment(geoSecondary, -x, -i, 0, x, -i, 0);
    }
    else {
      pushSegment(geoTertiary, -x, i, 0, x, i, 0);
      pushSegment(geoTertiary, -x, -i, 0, x, -i, 0);
    }
  }

  // draw a box around the print bed
  pushSegment(geoPrimary, -x, -y, 0, -x, y, 0);
  pushSegment(geoPrimary, -x, -y, 0, x, -y, 0);
  pushSegment(geoPrimary, -x, y, 0, x, y, 0);
  pushSegment(geoPrimary, x, -y, 0, x, y, 0);

  // draw vertical box
  if (z > 0) {
    pushSegment(geoTertiary, -x, -y, z, -x, y, z);
    pushSegment(geoTertiary, -x, -y, z, x, -y, z);
    pushSegment(geoTertiary, -x, y, z, x, y, z);
    pushSegment(geoTertiary, x, -y, z, x, y, z);
    pushSegment(geoTertiary, -x, -y, 0, -x, -y, z);
    pushSegment(geoTertiary, -x, y, 0, -x, y, z);
    pushSegment(geoTertiary, x, -y, 0, x, -y, z);
    pushSegment(geoTertiary, x, y, 0, x, y, z);
  }

  var linePrimary = new THREE.LineSegments(geoPrimary, matPrimary);
  var lineSecondary = new THREE.LineSegments(geoSecondary, matSecondary);
  var lineTertiary = new THREE.LineSegments(geoTertiary, matTertiary);
  linePrimary.name = "buildVolume";
  lineSecondary.name = "buildVolume";
  lineTertiary.name = "buildVolume";
  this.scene.add(linePrimary);
  this.scene.add(lineSecondary);
  this.scene.add(lineTertiary);

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

  model.isLittleEndian = this.isLittleEndian;
  model.vertexPrecision = this.vertexPrecision;
  model.import(file, this.displayMesh.bind(this));
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

  // todo: remove
  //this.generateSupports();
  this.activateSliceMode();

  this.cameraToModel();

  // todo: remove
  this.currentLevel = 140;
  this.setLevel();

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
