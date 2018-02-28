/* stage.js
   classes:
    Stage
   description:
    Main class representing the Meshy viewport. Encompasses UI, creating and
    handling the model, and controlling the viewport.
*/

// Constructor.
Stage = function() {
  // params
  this.floorSize = 50;

  // toggles
  this.importEnabled = true;
  this.importingMeshName = "";
  this.floorVisible = true;

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
// initializes floor.
Stage.prototype.generateUI = function() {
  this.gui = new dat.GUI();
  this.gui.add(this, "import");

  var exportFolder = this.gui.addFolder("Export");
  this.filename = "meshy";
  this.filenameController = exportFolder.add(this, "filename");
  exportFolder.add(this, "exportOBJ");
  exportFolder.add(this, "exportSTL");
  exportFolder.add(this, "exportSTLascii");

  var settingsFolder = this.gui.addFolder("Settings");
  settingsFolder.add(this, "toggleFloor");
  settingsFolder.add(this, "toggleAxisWidget");

  var displayFolder = this.gui.addFolder("Mesh Display");
  displayFolder.add(this, "toggleCOM");
  displayFolder.add(this, "toggleWireframe");
  displayFolder.add(this, "cameraToModel");
  this.meshColor = "#662828"; // todo: reset to 0xffffff
  this.meshColorController =
    displayFolder.addColor(this, "meshColor").onChange(this.setMeshColor.bind(this));

  var technicalFolder = settingsFolder.addFolder("Technical");
  technicalFolder.add(this, "isLittleEndian");
  technicalFolder.add(this, "vertexPrecision").onChange(this.setVertexPrecision.bind(this));

  var transformFolder = this.gui.addFolder("Transform");

  var translateFolder = transformFolder.addFolder("Translate");
  this.xTranslation = 0;
  translateFolder.add(this, "xTranslation");
  translateFolder.add(this, "translateX");
  this.yTranslation = 0;
  translateFolder.add(this, "yTranslation");
  translateFolder.add(this, "translateY");
  this.zTranslation = 0;
  translateFolder.add(this, "zTranslation");
  translateFolder.add(this, "translateZ");

  var rotateFolder = transformFolder.addFolder("Rotate");
  this.xRotation = 0;
  rotateFolder.add(this, "xRotation");
  rotateFolder.add(this, "rotateX");
  this.yRotation = 0;
  rotateFolder.add(this, "yRotation");
  rotateFolder.add(this, "rotateY");
  this.zRotation = 0;
  rotateFolder.add(this, "zRotation");
  rotateFolder.add(this, "rotateZ");

  var scaleFolder = transformFolder.addFolder("Scale");

  var scaleByFactorFolder = scaleFolder.addFolder("Scale By Factor");
  this.xScale = 1;
  scaleByFactorFolder.add(this, "xScale", 0);
  scaleByFactorFolder.add(this, "scaleX");
  this.yScale = 1;
  scaleByFactorFolder.add(this, "yScale", 0);
  scaleByFactorFolder.add(this, "scaleY");
  this.zScale = 1;
  scaleByFactorFolder.add(this, "zScale", 0);
  scaleByFactorFolder.add(this, "scaleZ");
  this.allScale = 1;
  scaleByFactorFolder.add(this, "allScale", 0);
  scaleByFactorFolder.add(this, "scaleAll");

  var scaleToSizeFolder = scaleFolder.addFolder("Scale To Size");
  this.scaleOnAllAxes = true;
  scaleToSizeFolder.add(this, "scaleOnAllAxes");
  this.newXSize = 1;
  scaleToSizeFolder.add(this, "newXSize", 0);
  scaleToSizeFolder.add(this, "scaleToXSize");
  this.newYSize = 1;
  scaleToSizeFolder.add(this, "newYSize", 0);
  scaleToSizeFolder.add(this, "scaleToYSize");
  this.newZSize = 1;
  scaleToSizeFolder.add(this, "newZSize", 0);
  scaleToSizeFolder.add(this, "scaleToZSize");

  this.scaleToMeasurementFolder = scaleFolder.addFolder("Scale To Measurement");

  var ringSizeFolder = scaleFolder.addFolder("Scale To Ring Size");
  ringSizeFolder.add(this, "mCircle");
  this.newRingSize = 0;
  ringSizeFolder.add(this, "newRingSize", ringSizes);
  ringSizeFolder.add(this, "scaleToRingSize");
  ringSizeFolder.add(this, "mDeactivate");

  var mirrorFolder = transformFolder.addFolder("Mirror");
  mirrorFolder.add(this, "mirrorX");
  mirrorFolder.add(this, "mirrorY");
  mirrorFolder.add(this, "mirrorZ");

  var floorFolder = transformFolder.addFolder("Floor");
  floorFolder.add(this, "floorX");
  floorFolder.add(this, "floorY");
  floorFolder.add(this, "floorZ");

  var centerFolder = transformFolder.addFolder("Center");
  centerFolder.add(this, "centerAll");
  centerFolder.add(this, "centerX");
  centerFolder.add(this, "centerY");
  centerFolder.add(this, "centerZ");

  transformFolder.add(this, "flipNormals");

  var calculationFolder = this.gui.addFolder("Calculate");
  calculationFolder.add(this, "calcSurfaceArea");
  calculationFolder.add(this, "calcVolume");
  calculationFolder.add(this, "calcCenterOfMass");

  var measurementFolder = this.gui.addFolder("Measure");
  measurementFolder.add(this, "mLength");
  measurementFolder.add(this, "mAngle");
  measurementFolder.add(this, "mCircle");
  measurementFolder.add(this, "mCrossSectionX");
  measurementFolder.add(this, "mCrossSectionY");
  measurementFolder.add(this, "mCrossSectionZ");
  measurementFolder.add(this, "mDeactivate");

  var thicknessFolder = this.gui.addFolder("Mesh Thickness");
  this.thicknessThreshold = 0.1;
  thicknessFolder.add(this, "thicknessThreshold", 0);
  thicknessFolder.add(this, "viewThickness");
  thicknessFolder.add(this, "clearThicknessView");

  var repairFolder = this.gui.addFolder("Repair (beta)");
  repairFolder.add(this, "generatePatch");
  repairFolder.add(this, "acceptPatch");
  repairFolder.add(this, "cancelPatch");

  this.verticalResolution = 0.05;
  this.planarResolution = 0.05;
  this.upAxis = "z";
  var supportSlicingFolder = this.gui.addFolder("Supports & Slicing (beta)");
  supportSlicingFolder.add(this, "verticalResolution", .0001, 1);
  supportSlicingFolder.add(this, "planarResolution", .0001, 1);
  supportSlicingFolder.add(this, "upAxis", ["x", "y", "z"]);

  this.supportAngle = 45;
  this.supportSpacingFactor = 14;
  this.supportRadius = this.planarResolution;
  var supportFolder = supportSlicingFolder.addFolder("Supports");
  supportFolder.add(this, "supportAngle", 0, 90);
  supportFolder.add(this, "supportSpacingFactor", 1, 20);
  supportFolder.add(this, "supportRadius", 0.0001, 1);
  supportFolder.add(this, "generateSupports");
  supportFolder.add(this, "removeSupports");

  this.sliceNumWalls = 2;
  this.sliceFolder = supportSlicingFolder.addFolder("Slice");
  this.buildSliceFolderInactive();

  this.gui.add(this, "undo");
  this.gui.add(this, "redo");
  this.gui.add(this, "delete");

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
  this.initFloor();
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

    this.model.generateSupports(
      this.supportAngle,
      this.planarResolution * this.supportSpacingFactor,
      this.verticalResolution,
      this.supportRadius,
      this.upAxis);
  }
}
Stage.prototype.removeSupports = function() {
  if (this.model) this.model.removeSupports();
}
// build the Slice folder for when slice mode is off
Stage.prototype.buildSliceFolderInactive = function() {
  this.clearFolder(this.sliceFolder);
  this.sliceFolder.add(this, "activateSliceMode");
}
// build the Slice folder for when slice mode is on
Stage.prototype.buildSliceFolderActive = function() {
  if (!this.model) return;

  var numSlices = this.model.getNumSlices();
  if (numSlices !== 0) {
    this.clearFolder(this.sliceFolder);
    this.currentSlice = this.model.getCurrentSlice();
    this.sliceController = this.sliceFolder.add(
      this,
      "currentSlice",
      0, numSlices
    ).step(1).onChange(this.setSlice.bind(this));
    this.sliceMode = this.model.getSliceMode();
    this.sliceFolder.add(
      this,
      "sliceMode",
      ["preview", "layer"]
    ).onChange(this.setSliceMode.bind(this));

    this.sliceSettingsFolder = this.sliceFolder.addFolder("Layer Settings");
    this.sliceSettingsFolder.add(this, "sliceNumWalls", 1).step(1);
    this.sliceSettingsFolder.add(this, "recalculateLayers");
  }

  this.sliceFolder.add(this, "deactivateSliceMode");
}
Stage.prototype.setSliceMode = function() {
  if (this.model) this.model.setSliceMode(this.sliceMode);
}
Stage.prototype.activateSliceMode = function() {
  if (this.model) {
    this.model.activateSliceMode({
      axis: this.upAxis,
      sliceHeight: this.verticalResolution,
      lineWidth: this.planarResolution,
      numWalls: this.sliceNumWalls
    });
    this.buildSliceFolderActive();
  }
}
Stage.prototype.deactivateSliceMode = function() {
  if (this.model) {
    this.buildSliceFolderInactive();
    this.model.deactivateSliceMode();
  }
}
Stage.prototype.setSlice = function() {
  if (this.model) {
    this.model.setSlice(this.currentSlice);
  }
}
Stage.prototype.recalculateLayers = function() {
  if (this.model) {
    this.model.recalculateLayers(this.printLineWidth, this.sliceNumWalls);
  }
}
Stage.prototype.buildScaleToMeasurementFolder = function() {
  this.clearFolder(this.scaleToMeasurementFolder);
  if (this.model) this.scalableMeasurements = this.model.getScalableMeasurements();
  if (this.scalableMeasurements && this.scalableMeasurements.length>0) {
    this.measurementToScale = this.scalableMeasurements[0];
    this.newMeasurementValue = 1;
    this.scaleToMeasurementFolder.add(this, "measurementToScale", this.scalableMeasurements);
    this.scaleToMeasurementFolder.add(this, "newMeasurementValue", 0);
    this.scaleToMeasurementFolder.add(this, "scaleToMeasurement");
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

Stage.prototype.toggleFloor = function() {
  this.floorVisible = !this.floorVisible;
  this.setFloorState();
}
Stage.prototype.setFloorState = function() {
  var visible = this.floorVisible;
  this.scene.traverse(function(o) {
    if (o.name=="floor") o.visible = visible;
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
Stage.prototype.setMeshColor = function() {
  if (this.model) this.model.setMeshColor(this.meshColor);
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

    _this.camera = new THREE.PerspectiveCamera(30, width/height, .1, 100000);
    // z axis is up as is customary for 3D printers
    _this.camera.up.set(0, 0, 1);

    _this.scene = new THREE.Scene();
    debug = new Debug(_this.scene); // todo: remove
    _this.scene.background = new THREE.Color(0x222222);

    _this.controls = new Controls(
      _this.camera,
      _this.container,
      {
        r: 10,
        phi: Math.PI/3,
        theta: 5*Math.PI/12
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
    if (e.ctrlKey) {
      if (e.shiftKey) {
        if (e.key=="Z") _this.redo();
      }
      else {
        if (e.key=="z") _this.undo();
        if (e.key=="y") _this.redo();
      }
    }
    else {
      if (e.key=="f") _this.cameraToModel();
      else if (e.key=="c") _this.toggleCOM();
      else if (e.key=="w") _this.toggleWireframe();
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

// Create the floor.
Stage.prototype.initFloor = function() {
  var size = this.floorSize;

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

  geoPrimary.vertices.push(new THREE.Vector3(0,-size,0));
  geoPrimary.vertices.push(new THREE.Vector3(0,size,0));
  geoPrimary.vertices.push(new THREE.Vector3(-size,0,0));
  geoPrimary.vertices.push(new THREE.Vector3(size,0,0));
  for (var i=-size; i<=size; i++) {
    if (i==0) continue;
    if (i%5==0) {
      geoSecondary.vertices.push(new THREE.Vector3(i,-size,0));
      geoSecondary.vertices.push(new THREE.Vector3(i,size,0));
      geoSecondary.vertices.push(new THREE.Vector3(-size,i,0));
      geoSecondary.vertices.push(new THREE.Vector3(size,i,0));
    }
    else {
      geoTertiary.vertices.push(new THREE.Vector3(i,-size,0));
      geoTertiary.vertices.push(new THREE.Vector3(i,size,0));
      geoTertiary.vertices.push(new THREE.Vector3(-size,i,0));
      geoTertiary.vertices.push(new THREE.Vector3(size,i,0));
    }
  }
  var linePrimary = new THREE.LineSegments(geoPrimary, matPrimary);
  var lineSecondary = new THREE.LineSegments(geoSecondary, matSecondary);
  var lineTertiary = new THREE.LineSegments(geoTertiary, matTertiary);
  linePrimary.name = "floor";
  lineSecondary.name = "floor";
  lineTertiary.name = "floor";
  this.scene.add(linePrimary);
  this.scene.add(lineSecondary);
  this.scene.add(lineTertiary);

  this.setFloorState();
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
  if (!success) {
    // it's necessary to clear file input box because it blocks importing
    // a model with the same name twice in a row
    this.fileInput.value = "";

    this.model = null;
    return;
  }

  // set model
  this.model = model;

  this.importEnabled = true;

  // failsafe
  if (!this.model) {
    removeMeshByName(this.scene, "model");
    return;
  }

  // todo: remove
  this.generateSupports();
  //this.activateSliceMode();

  this.cameraToModel();
  this.filename = this.model.filename;
  this.setMeshColor();
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
