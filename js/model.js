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
function Model(scene, camera, container, printout, infoOutput, progressBarContainer) {
  // internal geometry
  this.faces = [];
  this.vertices = [];
  this.count = 0; // count of faces; used more often than count of vertices
  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;
  this.filename = "";
  this.setVertexPrecision(5);

  // calculated stuff
  this.resetBounds(); // sets bounds to Infinity
  this.surfaceArea = null;
  this.volume = null;
  this.centerOfMass = null;
  // octree
  this.octree = null;

  // for slicing
  this.sliceCount = null;
  this.numSlices = 30;
  this.delta = null;
  this.segmentLists = null;

  // for display
  this.wireframe = false;
  this.currentMesh = null;
  this.plainMesh = null;
  this.slicedMesh = null;
  this.scene = scene;
  this.camera = camera;
  this.container = container;
  this.infoOutput = infoOutput;
  this.printout = printout ? printout : console;
  // three orthogonal planes that intersect at the center of the mesh
  this.targetPlanes = null;
  this.showCenterOfMass = false;

  // for patching the mesh
  this.patchMat = new THREE.MeshStandardMaterial({
    color: 0x44ff44,
    wireframe: false
  });
  this.patchMesh = null;

  this.measurement = new Measurement(this.scene, this.camera, this.container, this.printout);
  this.measurement.setOutput(this.infoOutput);

  // currently active non-thread-blocking calculations; each is associated with
  // an iterator and a progress bar and label in the UI
  this.iterators = {};
  this.progressBarContainer = progressBarContainer;
}

// Add a Face3 to the model.
Model.prototype.add = function(face) {
  this.faces.push(face);
  this.count++;
  this.updateBoundsF(face);
}

// All bounds to Infinity.
Model.prototype.resetBounds = function() {
  this.xmin = Infinity;
  this.xmax = -Infinity;
  this.ymin = Infinity;
  this.ymax = -Infinity;
  this.zmin = Infinity;
  this.zmax = -Infinity;
}

// Update the bounds with a new face.
Model.prototype.updateBoundsF = function(face) {
  var verts = faceGetVerts(face, this.vertices);
  for (var i=0; i<3; i++) this.updateBoundsV(verts[i]);
}

// Update bounds with a new vertex.
Model.prototype.updateBoundsV = function(v) {
  this.xmin = v.x<this.xmin ? v.x : this.xmin;
  this.xmax = v.x>this.xmax ? v.x : this.xmax;
  this.ymin = v.y<this.ymin ? v.y : this.ymin;
  this.ymax = v.y>this.ymax ? v.y : this.ymax;
  this.zmin = v.z<this.zmin ? v.z : this.zmin;
  this.zmax = v.z>this.zmax ? v.z : this.zmax;
}

// Get the bounds as one object.
Model.prototype.getBounds = function() {
  return {
    xmin: this.xmin,
    xmax: this.xmax,
    ymin: this.ymin,
    ymax: this.ymax,
    zmin: this.zmin,
    zmax: this.zmax
  };
}

// Get a vector representing the coords of the center.
Model.prototype.getCenter = function() {
  return new THREE.Vector3(this.getCenterx(), this.getCentery(), this.getCenterz());
}
// Get individual coords of the center.
Model.prototype.getCenterx = function() { return (this.xmax+this.xmin)/2; }
Model.prototype.getCentery = function() { return (this.ymax+this.ymin)/2; }
Model.prototype.getCenterz = function() { return (this.zmax+this.zmin)/2; }
// Get a list representing the size of the model in every direction.
Model.prototype.getSize = function() {
  return new THREE.Vector3(this.getSizex(), this.getSizey(), this.getSizez());
}
// Get individual sizes of the model.
Model.prototype.getSizex = function() { return (this.xmax-this.xmin); }
Model.prototype.getSizey = function() { return (this.ymax-this.ymin); }
Model.prototype.getSizez = function() { return (this.zmax-this.zmin); }
// Largest dimension of the model.
Model.prototype.getMaxSize = function() {
  var size = this.getSize();
  return Math.max(size.x, Math.max(size.y, size.z));
}
// Smallest dimension of the model.
Model.prototype.getMinSize = function() {
  var size = this.getSize();
  return Math.min(size.x, Math.min(size.y, size.z));
}
// Individual center of mass coords.
Model.prototype.getCOMx = function() {
  if (this.centerOfMass) return this.centerOfMass.x;
  return null;
}
Model.prototype.getCOMy = function() {
  if (this.centerOfMass) return this.centerOfMass.y;
  return null;
}
Model.prototype.getCOMz = function() {
  if (this.centerOfMass) return this.centerOfMass.z;
  return null;
}
Model.prototype.setVertexPrecision = function(precision) {
  this.vertexPrecision = precision;
  this.p = Math.pow(10, precision);
}

/* TRANSFORMATIONS */

// Translate the model on axis ("x"/"y"/"z") by amount.
Model.prototype.translate = function(axis, amount) {
  this.printout.log("translation by "+amount+" units on "+axis+" axis");
  for (var i=0; i<this.vertices.length; i++) {
    this.vertices[i][axis] += amount;
  }

  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  this.plainMesh.geometry.boundingSphere = null;
  this.plainMesh.geometry.boundingBox = null;
  //transform bounds
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;

  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass[axis] += amount;
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  this.measurement.translate(axis, amount);
}

// Rotate the model on axis ("x"/"y"/"z") by "amount" degrees.
Model.prototype.rotate = function(axis, amount) {
  this.printout.log("rotation by "+amount+" degrees about "+axis+" axis");
  this.resetBounds();
  amount = amount*Math.PI/180.0;
  var axisVector = axisToVector3Map[axis];
  for (var i=0; i<this.vertices.length; i++) {
    var vertex = this.vertices[i];
    vertex.applyAxisAngle(axisVector, amount);
    this.updateBoundsV(vertex);
  }
  for (var i=0; i<this.count; i++) {
    this.faces[i].normal.applyAxisAngle(axisVector, amount);
  }

  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  this.plainMesh.geometry.boundingSphere = null;
  this.plainMesh.geometry.boundingBox = null;
  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass.applyAxisAngle(axisToVector3Map[axis],amount);
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  // size argument is necessary for resizing things that aren't rotationally
  // symmetric
  this.measurement.rotate(axis, amount, this.getSize());
}

// Scale the model on axis ("x"/"y"/"z") by amount.
Model.prototype.scale = function (axis, amount) {
  this.printout.log("scale by a factor of "+amount+" along "+axis+" axis");
  for (var i=0; i<this.vertices.length; i++) {
    this.vertices[i][axis] *= amount;
  }

  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  this.plainMesh.geometry.boundingSphere = null;
  this.plainMesh.geometry.boundingBox = null;
  this.surfaceArea = null;
  this.volume = null;
  this[axis+"min"] *= amount;
  this[axis+"max"] *= amount;
  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass[axis] *= amount;
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  this.measurement.scale(axis, amount);
}

/* MEASUREMENT */

// If current measurement has the given "type", return its value.
Model.prototype.getMeasuredValue = function (type) {
  if (this.measurement) {
    if (this.measurement.active) {
      var currentValue = this.measurement.getMeasuredValue(type);
      if (currentValue!==null) {
        if (currentValue>0) return currentValue;
        else {
          this.printout.warn("New value can't be 0 or negative.");
          return null;
        }
      }
      else {
        this.printout.warn("The currently active measurement doesn't contain the attribute '" + type + "'.");
        return null;
      }
    }
    else {
      this.printout.warn("Can't get value for " + type + "; no measurement currently active.");
      return null;
    }
  }
  return null;
}

// Get an array of names for values that are being measured, as long as it's
// possible to scale to them.
Model.prototype.getScalableMeasurements = function() {
  if (this.measurement && this.measurement.active) {
    return this.measurement.getScalableMeasurements();
  }
  return null;
}

Model.prototype.activateMeasurement = function (type, param) {
  if (this.measurement) {
    var activated;
    // If param supplied, need to pass in extra information in a params object.
    // If calculating cross-section, the param is an axis; also pass size,
    // center, and a function to calculate cross-section.
    if (param) {
      var params = {};
      if (type=="crossSection") {
        params.axis = param;
        params.size = this.getSize();
        params.center = this.getCenter();
        params.fn = this.calcCrossSection.bind(this);
      }

      activated = this.measurement.activate(type, params);
    }
    else {
      activated = this.measurement.activate(type);
    }
    return activated;
  }
}
Model.prototype.deactivateMeasurement = function () {
  if (this.measurement) this.measurement.deactivate();
}

/* CALCULATIONS */

// Calculate surface area.
Model.prototype.calcSurfaceArea = function() {
  this.surfaceArea = 0;
  for (var i=0; i<this.count; i++) {
    var face = this.faces[i];
    this.surfaceArea += this.faceCalcSurfaceArea(face);
  }
  return this.surfaceArea;
}

// Calculate volume.
Model.prototype.calcVolume = function() {
  this.volume = 0;
  for (var i=0; i<this.count; i++) {
    var face = this.faces[i];
    this.volume += this.faceCalcSignedVolume(face);
  }
}

// Calculate center of mass.
Model.prototype.calcCenterOfMass = function() {
  if (this.centerOfMass) return this.centerOfMass;
  var modelVolume = 0, faceVolume = 0;
  var center = new THREE.Vector3();
  for (var i=0; i<this.count; i++) {
    var face = this.faces[i];
    var verts = faceGetVerts(face, this.vertices);
    faceVolume = this.faceCalcSignedVolume(face);
    modelVolume += faceVolume;
    center.x += ((verts[0].x + verts[1].x + verts[2].x) / 4) * faceVolume;
    center.y += ((verts[0].y + verts[1].y + verts[2].y) / 4) * faceVolume;
    center.z += ((verts[0].z + verts[1].z + verts[2].z) / 4) * faceVolume;
  }
  this.volume = modelVolume;
  this.centerOfMass = center.divideScalar(modelVolume);
}

// Calculate cross-section.
Model.prototype.calcCrossSection = function(axis, pos) {
  var crossSection = 0;
  // for finding the range of the cross-section; axis1 and axis2 are the two
  // axes that
  var axis1 = cycleAxis(axis);
  var minAxis1 = Infinity, maxAxis1 = -Infinity;
  var axis2 = cycleAxis(axis1);
  var minAxis2 = Infinity, maxAxis2 = -Infinity;

  for (var i=0; i<this.count; i++) {
    var face = this.faces[i];
    var segment = this.faceIntersection(face, axis, pos);
    if (segment && segment.length==2) {
      // update the min and max
      minAxis1 = Math.min(minAxis1, segment[0][axis1]);
      maxAxis1 = Math.max(maxAxis1, segment[0][axis1]);
      minAxis2 = Math.min(minAxis2, segment[0][axis2]);
      maxAxis2 = Math.max(maxAxis2, segment[0][axis2]);

      // Calculate cross-section. Algorithm is like this:
      // 1. shift segment endpoints down to 0 on axis,
      // 2. calculate area of the triangle formed by segment and origin,
      // 3. multiply by sign, accumulate for all triangles
      segment[0][axis] = 0;
      segment[1][axis] = 0;
      var area = segment[0].cross(segment[1]).multiplyScalar(1/2).length();
      var sign = Math.sign(segment[1].dot(face.normal));
      crossSection += sign * area;
    }
  }

  var result = { crossSection: crossSection};
  result[axis1+"size"] = maxAxis1-minAxis1;
  result[axis2+"size"] = maxAxis2-minAxis2;
  return result;
}

// Calculate triangle area via cross-product.
Model.prototype.faceCalcSurfaceArea = function(face) {
  var v = new THREE.Vector3();
  var v2 = new THREE.Vector3();
  v.subVectors(this.vertices[face.a], this.vertices[face.b]);
  v2.subVectors(this.vertices[face.a], this.vertices[face.c]);
  v.cross(v2);
  this.surfaceArea = 0.5 * v.length();
  return this.surfaceArea;
}

// Calculate the volume of a tetrahedron with one vertex on the origin and
// with the triangle forming the outer face; sign is determined by the inner
// product of the normal with any of the vertices.
Model.prototype.faceCalcSignedVolume = function(face) {
  var sign = Math.sign(this.vertices[face.a].dot(face.normal));
  var v1 = this.vertices[face.a];
  var v2 = this.vertices[face.b];
  var v3 = this.vertices[face.c];
  var volume = (-v3.x*v2.y*v1.z + v2.x*v3.y*v1.z + v3.x*v1.y*v2.z);
  volume += (-v1.x*v3.y*v2.z - v2.x*v1.y*v3.z + v1.x*v2.y*v3.z);
  this.signedVolume = sign * Math.abs(volume/6.0);
  return this.signedVolume;
}

// Calculate the endpoints of the segment formed by the intersection of this
// triangle and a plane normal to the given axis.
// Returns an array of two Vector3s in the plane.
Model.prototype.faceIntersection = function(face, axis, pos) {
  var verts = faceGetVerts(face, this.vertices);
  var min = verts[0][axis], max = min;
  for (var i=1; i<3; i++) {
    var bound = verts[i][axis];
    if (bound<min) min = bound;
    if (bound>max) max = bound;
  }
  if (max<=pos || min>=pos) return [];

  var segment = [];
  for (var i=0; i<3; i++) {
    var v1 = verts[i];
    var v2 = verts[(i+1)%3];
    if ((v1[axis]<pos && v2[axis]>pos) || (v1[axis]>pos && v2[axis]<pos)) {
      var d = v2[axis]-v1[axis];
      if (d==0) return;
      var factor = (pos-v1[axis])/d;
      // more efficient to have a bunch of cases than being clever and calculating
      // the orthogonal axes and building a Vector3 from basis vectors, etc.
      if (axis=="x") {
        var y = v1.y + (v2.y-v1.y)*factor;
        var z = v1.z + (v2.z-v1.z)*factor;
        segment.push(new THREE.Vector3(pos,y,z));
      }
      else if (axis=="y") {
        var x = v1.x + (v2.x-v1.x)*factor;
        var z = v1.z + (v2.z-v1.z)*factor;
        segment.push(new THREE.Vector3(x,pos,z));
      }
      else { // axis=="z"
        var x = v1.x + (v2.x-v1.x)*factor;
        var y = v1.y + (v2.y-v1.y)*factor;
        segment.push(new THREE.Vector3(x,y,pos));
      }
    }
  }
  if (segment.length!=2) console.log("Plane-triangle intersection: strange segment length: ", segment);
  return segment;
}

/* UI AND RENDERING */

// Toggle wireframe.
Model.prototype.toggleWireframe = function() {
  this.wireframe = !this.wireframe;
  this.printout.log("wireframe is " + (this.wireframe ? "on" : "off"));
  if (this.plainMesh) {
    this.plainMesh.material.wireframe = this.wireframe;
  }
}

// Get and set material color.
Model.prototype.getMeshColor = function() {
  if (this.plainMesh) return this.plainMesh.material.color.getHex();
}
Model.prototype.setMeshColor = function(color) {
  if (this.plainMesh) return this.plainMesh.material.color.set(color);
}

// Toggle the COM indicator. If the COM hasn't been calculated, then
// calculate it.
Model.prototype.toggleCenterOfMass = function() {
  this.calcCenterOfMass();
  this.showCenterOfMass = !this.showCenterOfMass;
  this.printout.log("COM indicator is "+(this.showCenterOfMass ? "on" : "off"));
  var visible = this.showCenterOfMass;
  this.positionTargetPlanes(this.centerOfMass);
  this.scene.traverse(function(o) {
    if (o.name == "targetPlane") o.visible = visible;
  });
}

// Create the target planes forming the COM indicator.
Model.prototype.generateTargetPlanes = function() {
  var size = 1;
  this.targetPlanes = [
    new THREE.PlaneGeometry(size,size).rotateY(Math.PI/2), // normal x
    new THREE.PlaneGeometry(size,size).rotateX(Math.PI/2), // normal y
    new THREE.PlaneGeometry(size,size) // normal z
  ];
  var planeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  planeMat.transparent = true;
  planeMat.opacity = 0.5;
  var planeMeshes = [
    new THREE.Mesh(this.targetPlanes[0], planeMat),
    new THREE.Mesh(this.targetPlanes[1], planeMat),
    new THREE.Mesh(this.targetPlanes[2], planeMat)
  ];
  for (var i=0; i<planeMeshes.length; i++) {
    planeMeshes[i].name = "targetPlane";
    planeMeshes[i].visible = false;
    planeMeshes[i].frustumCulled = false;
    this.scene.add(planeMeshes[i]);
  }
}

// Position the COM indicator.
Model.prototype.positionTargetPlanes = function(point) {
  if (!this.targetPlanes) this.generateTargetPlanes();

  var vX = this.targetPlanes[0].vertices;
  var vY = this.targetPlanes[1].vertices;
  var vZ = this.targetPlanes[2].vertices;
  // arrange that the planes protrude from the boundaries of the object
  // by 0.1 times its size
  var extendFactor = 0.1;
  var size = this.getSize().multiplyScalar(extendFactor);
  var xmin = this.xmin-size.x, xmax = this.xmax+size.x;
  var ymin = this.ymin-size.y, ymax = this.ymax+size.y;
  var zmin = this.zmin-size.z, zmax = this.zmax+size.z;

  vX[0].set(point.x, ymin, zmin);
  vX[1].set(point.x, ymin, zmax);
  vX[2].set(point.x, ymax, zmin);
  vX[3].set(point.x, ymax, zmax);

  vY[0].set(xmin, point.y, zmin);
  vY[1].set(xmin, point.y, zmax);
  vY[2].set(xmax, point.y, zmin);
  vY[3].set(xmax, point.y, zmax);

  vZ[0].set(xmin, ymin, point.z);
  vZ[1].set(xmin, ymax, point.z);
  vZ[2].set(xmax, ymin, point.z);
  vZ[3].set(xmax, ymax, point.z);

  this.targetPlanes[0].verticesNeedUpdate = true;
  this.targetPlanes[1].verticesNeedUpdate = true;
  this.targetPlanes[2].verticesNeedUpdate = true;
}

// Render the THREE mesh; currently, only the "plain" mode is supported.
Model.prototype.render = function(scene, mode) {
  this.scene = scene;

  if (mode == "plain") {
    this.makePlainMesh(scene);
    this.currentMesh = this.plainMesh;
  }
  else if (mode == "sliced") {
    if (!this.segmentLists) {
      this.segmentLists = this.slice();
    }
    this.renderSlicedModel(scene);
    this.currentMesh = this.slicedMesh;
  }
}

// Create the plain mesh (as opposed to another display mode).
Model.prototype.makePlainMesh = function(scene) {
  if (this.plainMesh) return;
  /* set up camera, put in model */
  var geo = new THREE.Geometry();
  geo.vertices = this.vertices;
  geo.faces = this.faces;
  var mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: THREE.FaceColors
  });
  this.plainMesh = new THREE.Mesh(geo, mat);
  this.plainMesh.name = "model";
  this.plainMesh.frustumCulled = false;
  scene.add(this.plainMesh);
}

// use the geometry to build an octree; this is quite computationally expensive
// params:
//  d: optional depth argument; else, we determine it as ~log of polycount
//  nextIterator: optionally start this iterator when done building octree
Model.prototype.buildOctree = function(d, nextIterator) {
  // it's possible that the octree is being constructed right now; add the
  // callback if we have one, then return
  if (this.getIterator("octree")) {
    if (nextIterator) this.addNext("octree", nextIterator);
    return;
  }

  // heuristic is that the tree should be as deep as necessary to have 1-10 faces
  // per leaf node so as to make raytracing cheap; the effectiveness will vary
  // between different meshes, of course, but I estimate that ln(polycount)*0.6
  // should be good
  var depth = !d ? Math.round(Math.log(this.count)*0.6) : d;

  var meshSize = this.getSize();
  // find largest dimension
  var largestDimAxis = vector3ArgMax(meshSize);
  // make octree 1.1 times as large as largest dimension
  var size = meshSize[largestDimAxis] * 1.1;
  // center octree on model
  var origin = this.getCenter().subScalar(size/2);

  // create the octree; the last argument means that we will manually fill out
  // the geometry
  this.octree = new Octree(depth, origin, size, this.faces, this.vertices, this.scene, true);


  // fill out the octree in a non-blocking way

  // start by making the iterator
  var iterListEntry = this.makeIterator(
    {
      f: this.octree.addFace.bind(this.octree),
      n: this.faces.length,
      batchSize: clamp(this.faces.length/50, 1, 4500),
      onProgress: onProgress.bind(this),
      onDone: onDone.bind(this)
    },
    "octree",
    "Building octree..."
  );
  if (!iterListEntry) return;
  // add the next iterator if we have one
  if (nextIterator) this.addNext("octree", nextIterator);
  // and... begin
  this.startIterator("octree");

  // run this at every iteration; updates the progress bar
  function onProgress(i) {
    var bar = this.getIterator("octree").bar;
    if (bar) bar.set(i/this.faces.length);
  }

  function onDone() {
    this.printout.log("Octree constructed.");
  }
}


/* MESH THICKNESS */

// color the verts according to their local diameter
Model.prototype.viewThickness = function(threshold) {
  var iterListEntry = this.getIterator("thickness");
  if (iterListEntry) return;

  iterListEntry = this.makeIterator(
    {
      f: viewFaceThickness.bind(this),
      n: this.faces.length,
      batchSize: clamp(this.faces.length/50, 1, 4500),
      onDone: onDone.bind(this),
      onProgress: onProgress.bind(this)
    },
    "thickness",
    "Calculating mesh thickness..."
  );

  // if octree doesn't exist, build it and tell it to calculate thickness after
  if (!this.octree) this.buildOctree(null, "thickness");
  else {
    // if octree currently being calculated, tell it to calculate thickness
    // after it's done; else, just start calculating mesh thickness now
    var octreeIterator = this.getIterator("octree");
    if (octreeIterator) this.addNext("octree", "thickness");
    else this.startIterator("thickness");
  }

  function viewFaceThickness(i) {
    var face = this.faces[i];

    var verts = faceGetVerts(face, this.vertices);
    var faceCenter = verts[0].clone().add(verts[1]).add(verts[2]).multiplyScalar(1/3);
    var negativeNormal = face.normal.clone().multiplyScalar(-1);

    var intersection = this.octree.castRay(faceCenter, negativeNormal);

    var dist = 0;
    if (intersection) dist = faceCenter.distanceTo(intersection);

    var level = Math.min(dist/threshold, 1.0);
    face.color.setRGB(1.0, level, level);
  }


  function onDone() {
    this.plainMesh.geometry.colorsNeedUpdate = true;

    this.printout.log("Mesh thickness below the threshold is displayed in red.");
  }

  function onProgress(i) {
    var bar = this.getIterator("thickness").bar;
    if (bar) bar.set(i/this.faces.length);
  }
}

// reset the face color to white
Model.prototype.clearThicknessView = function() {
  for (var i=0; i<this.faces.length; i++) {
    this.faces[i].color.setRGB(1.0, 1.0, 1.0);
  }

  this.plainMesh.geometry.colorsNeedUpdate = true;
}


/* UTILITIES FOR DOING NON-BLOCKING CALCULATIONS. USE THESE TO AVOID LOCKING UP
   THE THREAD WHILE PERFORMING OUR CALCULATIONS. */

// create an iterator for calculation 'type' and store it in the 'iterators'
// table; only allowed to create one of a certain type at a time
// params:
//  params: object containing key-value pairs corresponding to the
//    parameters of functionIterator (see utils.js)
//  type: string identifying the type of calculation the iterator will perform
//  labelText: the label that will go on the progress bar
Model.prototype.makeIterator = function(params, type, labelText) {
  // check if an iterator of the same type already exists
  var iterListEntry = this.getIterator(type);
  if (iterListEntry) return null;

  // create the iterator
  var iterator = new functionIterator(
    params.f,
    params.n,
    params.batchSize,
    onDone.bind(this),
    params.onProgress,
    params.onStop
  );
  // create the iterator list entry and put it on the list
  iterListEntry = {
    iterator: iterator,
    labelText: labelText,
    next: []
  };
  this.iterators[type] = iterListEntry;

  // return the entry if successful
  return iterListEntry;

  function onDone() {
    this.removeIterator(type);

    if (params.onDone) params.onDone();

    var nextAll = iterListEntry.next;
    if (nextAll.length>0) {
      var next = nextAll[0];
      nextAll.splice(0,1);
      // preserve the remaining "next" iterators so that they'll run after the
      // one we will start now
      this.addNext(next, nextAll);

      this.startIterator(next);
    }
  }
}

// set up the UI for the (existing) iterator of a given type and start the
// calculation
Model.prototype.startIterator = function(type) {
  var iterListEntry = this.getIterator(type);
  if (!iterListEntry) return null;

  // do the UI setup - progress bar and its label

  // progress bar
  var bar = new ProgressBar.Line(
    "#progressBarContainer",
    {
      easing: 'easeInOut',
      color: '#dddddd',
      trailColor: 'rgba(255, 255, 255, 0.2)',
      strokeWidth: 0.25,
      duration: 16
    }
  );
  // need this to be able to remove the progress bar
  var barElement = this.progressBarContainer.lastChild;
  // text labeling the progress bar
  var label = document.createElement('span');
  label.className = "progressBarLabel";
  label.textContent = iterListEntry.labelText;
  this.progressBarContainer.appendChild(label);

  iterListEntry.bar = bar;
  iterListEntry.barElement = barElement;
  iterListEntry.label = label;

  // finally, start
  iterListEntry.iterator.start();
}

// given an existing iterator (can be in progress), add another iterator to its
// queue of iterators to run after it's done (the next param can be an array)
Model.prototype.addNext = function(type, next) {
  var iterListEntry = this.getIterator(type);
  if (!iterListEntry) return;

  if (isArray(next)) iterListEntry.next.concat(next);
  else iterListEntry.next.push(next);
}

// get an iterator from the iterator list
Model.prototype.getIterator = function(type) {
  return this.iterators[type]
}

// remove an iterator from the list and remove its progress bar + label; doesn't
// check whether the iterator is running or not
Model.prototype.removeIterator = function(type) {
  var removeProc = removeSingleIterator.bind(this);
  // if type specified, remove only that iterator; else, remove all
  if (type) removeProc(type);
  else {
    for (var key in this.iterators) removeProc(key);
  }

  function removeSingleIterator(key) {
    var iterListEntry = this.iterators[key];
    // if the given iterator type not found
    if (!iterListEntry) return;

    delete this.iterators[key];

    // remove progress bar and its label
    var barElement = iterListEntry.barElement;
    if (barElement) this.progressBarContainer.removeChild(barElement);
    var label = iterListEntry.label;
    if (label) this.progressBarContainer.removeChild(label);
  }
}

// force-stop a running iterator and remove it
Model.prototype.stopIterator = function(type) {
  var stopProc = stopSingleIterator.bind(this);
  // if type specified, stop only that iterator; else, stop all
  if (type) stopProc(type);
  else {
    for (var key in this.iterators) stopProc(key);
  }

  function stopSingleIterator(key) {
    this.printout.warn("Calculation canceled (" + key + ").");

    var iterListEntry = this.iterators[key];
    // if the given iterator type not found
    if (!iterListEntry) return;

    var iterator = iterListEntry.iterator;
    // stop the iterator
    if (iterator.running()) iterator.stop();

    // remove the iterator
    this.removeIterator(key);

    // also remove all of its "next" iterators
    var nextAll = iterListEntry.next;
    for (var i=0; i<nextAll; i++) {
      this.removeIterator(nextAll[i]);
    }
  }
}


// testing some octree stuff; leave in for future testing
Model.prototype.colorTest = function(color) {
  for (var i=0; i<this.faces.length; i++) {
    var face = this.faces[i];
    if (color) face.color.set(color);
    else face.color.set(0xff0000);

  }
  this.plainMesh.geometry.colorsNeedUpdate = true;
}

Model.prototype.rayTest = function(repeats) {
  // for visualizing verts
  var vertGeo = new THREE.Geometry();
  var vertMat = new THREE.PointsMaterial({color: 0xff0000, size: 0.04});
  var vertMesh = new THREE.Points(vertGeo, vertMat);
  this.scene.add(vertMesh);
  var vertLineGeo = new THREE.Geometry();
  var vertLineMat = new THREE.LineBasicMaterial({color: 0x8888ff});
  var vertLineMesh = new THREE.LineSegments(vertLineGeo, vertLineMat);
  this.scene.add(vertLineMesh);
  var _this = this;

  var threshold = 0.2;

  for (var i=0; i<this.faces.length; i++) {
    var face = this.faces[i];
    var n = face.normal;
    var dist = castRay(face);
    if (dist<0.000001) {
      console.log(i);
    }
    else {
      var level = Math.min(dist/threshold, 1.0);
      face.color.setRGB(1.0, level, level);
    }
    if (repeats===undefined) break;
    else {
      if (repeats<=0) break;
      else repeats--;
    }
  }

  this.plainMesh.geometry.colorsNeedUpdate = true;

  function castRay(face) {
    var verts = faceGetVerts(face, _this.vertices);
    var faceCenter = verts[0].clone().add(verts[1]).add(verts[2]).multiplyScalar(1/3);

    if (!_this.octree) _this.buildOctree();
    var p = faceCenter;
    var d = face.normal.clone().multiplyScalar(-1);
    var hit = _this.octree.castRay(p, d, _this.faces, _this.vertices);
    if (!hit) return 0;
    //showLine(p, hit);
    //showLine(hit);
    return hit.distanceTo(p);
  }

  function showLine(v1, v2) {
    vertGeo.vertices.push(v1);
    if (v2) {
      vertGeo.vertices.push(v2);
      vertLineGeo.vertices.push(v1);
      vertLineGeo.vertices.push(v2);
    }
  }
}


/* MESH REPAIR */

// take the existing patch geometry and integrate it into the model geometry
Model.prototype.acceptPatch = function() {
  if (!this.patchMesh) return;

  var vertices = this.patchMesh.geometry.vertices;
  var faces = this.patchMesh.geometry.faces;
  var vertexMap = {};
  var p = this.p;

  // add the model's existing verts into the map in order to be able to detect
  // shared vertices between the model and patch
  vertexArrayToMap(vertexMap, this.vertices, p);

  // clone each face and update its indices into the vertex array
  for (var f=0; f<faces.length; f++) {
    var face = faces[f].clone();
    face.a = vertexMapIdx(vertexMap, vertices[face.a], this.vertices, p);
    face.b = vertexMapIdx(vertexMap, vertices[face.b], this.vertices, p);
    face.c = vertexMapIdx(vertexMap, vertices[face.c], this.vertices, p);
    this.add(face);
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.elementsNeedUpdate = true;

  this.printout.log("Mesh patched.");

  this.removePatchMesh();
}

Model.prototype.cancelPatch = function() {
  if (!this.patchMesh) return;

  this.removePatchMesh();
  this.printout.log("Patch canceled.");
}

// remove the patch and clear associated data
Model.prototype.removePatchMesh = function() {
  this.patchMesh = null;

  if (!this.scene) return;
  for (var i=this.scene.children.length-1; i>=0; i--) {
    var child = this.scene.children[i];
    if (child.name=="patch" || child.name=="borderVerts") this.scene.remove(child);
  }
}

// the algorithm is like this:
//  1. generate an adjacency map
//  2. from the adjacency map, get the hash table of vertices that border holes
//  3. generate a list of border vertex cycles (wind them clockwise)
//  4. use the advancing front mesh (AFM) method to fill the holes
Model.prototype.generatePatch = function() {
  // remove any existing patch
  this.removePatchMesh();

  // for visualizing verts; unused, but leaving it here as debugging code
  var borderGeo = new THREE.Geometry();
  var borderMat = new THREE.PointsMaterial({color: 0xff0000, size: 0.07});
  var borderMesh = new THREE.Points(borderGeo, borderMat);
  borderMesh.name = "borderVerts";
  this.scene.add(borderMesh);

  // get the hash table detailing vertex adjacency
  var adjacencyMap = this.generateAdjacencyMap(this.vertices, this.faces, true, true);

  // vertex precision factor
  var p = this.p;

  // from the adjacency map, get a hash table containing only border vertices
  var borderMap = this.generateBorderMap(adjacencyMap);

  // check for empty border map; if properties exist, then holes exist
  if (objectIsEmpty(borderMap)) {
    this.printout.warn("This mesh does not contain holes.");
    return;
  }

  // array of THREE.Vertex3s and THREE.Face3s that will patch the holes
  var patchVertices = [];
  var patchFaces = [];
  // need to make the vertices unique
  var patchVertexMap = {};

  // construct THREE.Mesh and associated objects, add to scene
  var patchGeo = new THREE.Geometry();
  patchGeo.vertices = patchVertices;
  patchGeo.faces = patchFaces;
  this.patchMesh = new THREE.Mesh(patchGeo, this.patchMat);
  this.patchMesh.name = "patch";
  this.scene.add(this.patchMesh);

  // build an array of border edge cycles
  var borderCycles = [];
  var borderCycleNormals = [];

  while (true) {
    // start calculating a new cycle of border edges

    // break if no more border edges
    if (objectIsEmpty(borderMap)) break;

    // will contain a closed path of vertices
    var cycle = [];
    var cycleNormals = [];
    // only store cycle if search loop exits correctly
    var cycleClosed = false;

    var start = null;
    var current = null;
    var previous = null;
    // get a vertex from the borderMap that's on the edge of only one hole; if
    // nothing went wrong, this should always find such a vertex
    for (var key in borderMap) {
      if (borderMap[key].numHoles==1) {
        start = borderMap[key].vertex;
        break;
      }
    }
    // if can't get a vertex bordering only one hole, break (should never
    // fail here, but checking in case of weirdly malformed geometry)
    if (!start) break;
    current = start;

    // go along the cycle till we close the loop
    while (true) {
      // given a current vertex, search for the next vertex in the loop

      // hash current vertex to find its data
      var hash = vertexHash(current, p);
      var data = borderMap[hash];

      // juuuuuust in case; should never happen
      if (borderMap[hash]===undefined) break;

      // get the vertex's neighbors
      var neighbors = data.neighbors;
      var normal = data.normal;

      // store vertex in the cycle
      cycle.push(current);
      cycleNormals.push(normal);

      // if we're on the first vertex, need to wind the cycle in a consistent
      // direction (CW here) to make face generation easier
      if (previous==null) {
        // pick one of the two neighbors as next, giving a (next-current) edge;
        // if its winding order in the adjacency map is negative, that means the
        // adjacent geometry is to the left (looking along the negative normal)
        // and we're winding CW; if winding order is positive, need to pick the
        // other neighbor as next
        var next = neighbors[0];
        var currentAdjacentData = adjacencyMap[hash];
        if (currentAdjacentData.windingOrder[currentAdjacentData.neighbors.indexOf(next)]<0) {
          next = neighbors[1];
        }

        previous = current;
        current = next;
      }
      // else, two possibilities:
      //  1. current vertex borders only one hole; if so, just pick the neighbor
      //    that's not previous
      //  2. current vertex borders multiple holes; if so, find the neighbor
      //    that borders the same hole
      else {
        if (data.numHoles==1) {
          // pick the neighbor that's not previous
          var tmp = current;
          current = neighbors[0];
          if (current==previous) current = neighbors[1];
          previous = tmp;
        }
        else {
          // heuristic goes like this:
          //  1. project the edges out of current onto the plane perpendicular
          //    to the vertex normal
          //  2. find the one that's CCW from the prev-current edge, if
          //    looking along negative normal
          //  3. that edge points to the correct next vertex, assuming a
          //    correctly calculated normal
          var edges = [];
          for (var i=0; i<neighbors.length; i++) {
            // edge from current to neighbor
            edges[i] = neighbors[i].clone().sub(current);
            // project out the component along the normal
            edges[i] = edges[i].sub(normal.clone().multiplyScalar(normal.dot(edges[i]))).normalize();
          }

          // the angles of the outflowing edges around current vertex
          var angles = [];
          // need to be aware of the edge leading to previous vert; its angle
          // will be 0
          var prevEdge = edges[neighbors.indexOf(previous)];
          // orthogonal to both prevEdge and normal; use this to test for angles
          // greater than pi
          var orthogonalVector = prevEdge.clone().cross(normal);
          // calculate angles of every edge around normal w.r.t. prevEdge
          for (var i=0; i<edges.length; i++) {
            var edge = edges[i];
            if (edge==prevEdge) {
              angles[i] = 0;
              continue;
            }
            angles[i] = Math.acos(edge.dot(prevEdge));
            if (edge.dot(orthogonalVector)<0) angles[i] = 2.0*Math.PI - angles[i];
          }

          // find the edge that forms the largest angle with the edge to the
          // previous vert, so it's the first edge CCW from prevEdge
          var maxAngleIdx = 0;
          var maxAngle = angles[0];
          for (var i=1; i<angles.length; i++) {
            var angle = angles[i];
            if (angle>maxAngle) {
              maxAngleIdx = i;
              maxAngle = angle;
            }
          }
          var next = neighbors[maxAngleIdx];

          // need to remove prev and next from the neighbors list so that future
          // iterations don't take those turns
          neighbors.splice(neighbors.indexOf(previous), 1);
          neighbors.splice(neighbors.indexOf(next), 1);

          previous = current;
          current = next;
        }
      }

      // if single-hole vertex, delete its entry in the border map; if bordering
      // multiple holes, decrement number of adjacent holes
      if (data.numHoles==1) delete borderMap[hash];
      else data.numHoles--;

      // if we've reached the end of the loop, break
      if (current==start) {
        cycleClosed = true;
        break;
      }
    }

    // if cycle search loop found a correctly formed cycle, add it to the list;
    // should always happen, bugs notwithstanding
    if (cycleClosed) {
      borderCycles.push(cycle);
      borderCycleNormals.push(cycleNormals);
    }
  }

  // patch every border cycle
  for (var c=0; c<borderCycles.length; c++) {
    var cycle = borderCycles[c].slice();
    var normals = borderCycleNormals[c];

    var n = cycle.length;
    var originalCycleLength = n;
    var originalCyclePathLength = 0;
    var originalFaceCount = patchFaces.length;
    // every cycle should be nonempty, but check this just in case
    if (n==0) continue;

    // array of edges from vertex i to vertex i+1 (loops around at the end)
    var edges = [];
    // center of the hole
    var center = new THREE.Vector3();
    // average length of the edges
    var avgLen = 0;
    // average distance of cycle verts from the center
    var avgDist = 0;

    for (var i=0; i<n; i++) {
      var v = cycle[i];
      edges.push(cycle[(i+1)%n].clone().sub(v));
      var len = edges[i].length();
      avgLen += len/n;
      originalCyclePathLength += len;
      center.add(v.clone().divideScalar(n));
    }
    for (var i=0; i<n; i++) {
      avgDist += cycle[i].distanceTo(center)/n;
    }
    var angles = [];
    for (var i=0; i<n; i++) {
      angles.push(calculateAngleFromEdges(i, edges, cycle, normals, n));
    }

    // merge new vertices if adjacent edge length is below this threshold
    var threshold = avgLen * 1;
    // determines the combination of v and centerVector at each step; final
    // vertex is v + centerVector*redirectFactor, where centerVector is scaled
    // to the same length as v
    var redirectFactor = 0.2;

    var count = 0;

    // while the cycle of border edges can't be bridged by a single triangle,
    // add or remove vertices by the advancing front mesh method
    while (cycle.length>3) {
      count++;
      // if the front is expanding infinitely or doing something funky, break
      if (count%originalCycleLength==0) {
        var newPathLength = edges.reduce(function(acc,x) {return acc+x.length()}, 0);
        if (newPathLength > originalCyclePathLength) break;
      }

      // find vertex whose adjacent edges have the smallest angle
      var angle = angles[0];
      var idx = 0;
      for (var i=1; i<n; i++) {
        var a = angles[i];
        if (a < angle) {
          angle = a;
          idx = i;
        }
      }

      // local indices of cycle[idx] neighbors
      var prevIdx = (idx-1+n)%n;
      var nextIdx = (idx+1)%n;
      // cycle[idx] and its neighbors
      var v = cycle[idx];
      var vprev = cycle[prevIdx];
      var vnext = cycle[nextIdx];

      // indices into the patch vertex array
      var patchvidx = vertexMapIdx(patchVertexMap, v, patchVertices, p);
      var patchprevidx = vertexMapIdx(patchVertexMap, vprev, patchVertices, p);
      var patchnextidx = vertexMapIdx(patchVertexMap, vnext, patchVertices, p);

      // edges from v to next and from v to prev
      var enext = edges[idx];
      var eprev = edges[prevIdx].clone().multiplyScalar(-1);

      var centerVector = center.clone().sub(v);

      var newVerts;
      // determine how many verts to create; these rules are a modification of
      // those found in "A robust hole-filling algorithm for triangular mesh",
      // Zhao, Gao, Lin
      if (angle < 1.308996939) { // if angle < 75 degrees
        // do nothing; we're not creating any vertices
        newVerts = [];
      }
      else if (angle < 2.356194490) { // if 75 degrees <= angle < 135 degrees
        // create a new vertex and set its distance from v to be the average of
        // the two existing edges
        var v1 = eprev.clone().setLength((eprev.length()+enext.length())/2.0);
        // rotate and move the new vertex into position
        v1.applyAxisAngle(enext.clone().cross(eprev).normalize(), -angle/2.0).add(v);

        // check if the length is below the threshold; if so, skip creating the
        // vertex and just make one face
        if (v1.distanceTo(vnext)<threshold) {
          newVerts = [];
        }
        else {
          newVerts = [v1];
        }
      }
      else { // angle >= 135 degrees
        // create new vertices, interpolate their lengths between enext & eprev
        var prevlen = eprev.length(), nextlen = enext.length();
        var v1 = eprev.clone().setLength((prevlen*2.0+nextlen)/3.0);
        var v2 = eprev.clone().setLength((prevlen+nextlen*2.0)/3.0);
        // rotate and move the new vertices into position
        var axis = enext.clone().cross(eprev).normalize();
        v1.applyAxisAngle(axis, -angle/3.0).add(v);
        v2.applyAxisAngle(axis, -angle*2.0/3.0).add(v);

        // check if the length is below the threshold; if so, skip creating the
        // vertex and just make one face
        if (v2.distanceTo(v1)<threshold) {
          // removing v2; take v1, set it to the midpoint of v1 and v2
          v1.add(v2).divideScalar(2.0);
          newVerts = [v1];
        }
        else {
          newVerts = [v1, v2];
        }
      }

      if (newVerts.length==0) {
        // just make a face and remove v from the cycle
        var face = new THREE.Face3();
        face.a = patchvidx;
        // we know the order because the border vert cycle winds CW (see above)
        face.b = patchprevidx;
        face.c = patchnextidx;
        face.normal = vprev.clone().sub(v).cross(edges[idx]).normalize();
        patchFaces.push(face);

        n -= 1;
        // remove v from the cycle because it's been patched over
        cycle.splice(idx, 1);
        // update edges, angles, and normals
        edges.splice(idx, 1);
        angles.splice(idx, 1);
        normals.splice(idx, 1);
        // now idx will point to vprev
        if (idx==0) idx = prevIdx-1;
        else idx = prevIdx;
        nextIdx = (idx+1)%n;
        edges[idx] = cycle[nextIdx].clone().sub(cycle[idx]);
        // recalculate normals for the two vertices whose neigbors were changed;
        // set this as the old normal plus the new face's normal, both weighted
        // by their angle contributions at the vertex (old normal is weighted by
        // 2pi-angle, face normal by the angle between face's outermost edge and
        // the other edge adjacent to the vertex)
        // (you can really feel the clunky notation here >.>...)
        var faceAngle;
        faceAngle = Math.acos(
          edges[idx].clone().normalize().dot(
            v.clone().sub(cycle[idx]).normalize()
          )
        )*2.0;
        normals[idx].multiplyScalar(2*Math.PI-angle)
          .add(face.normal.clone().multiplyScalar(faceAngle)).normalize();
        faceAngle = Math.acos(
          edges[idx].clone().normalize().dot(
            cycle[nextIdx].clone().sub(v).normalize()
          )
        )*2.0;
        normals[nextIdx].multiplyScalar(2*Math.PI-angles[nextIdx])
          .add(face.normal.clone().multiplyScalar(faceAngle)).normalize();
        // recalculate angles
        angles[idx] = calculateAngleFromEdges(idx, edges, cycle, normals, n);
        angles[nextIdx] = calculateAngleFromEdges(nextIdx, edges, cycle, normals, n);
      }
      else if (newVerts.length==1) {
        var v1 = newVerts[0];
        // put the vertex into the patch map
        var patchv1idx = vertexMapIdx(patchVertexMap, v1, patchVertices, p);

        // new edge
        var e1 = v1.clone().sub(v);

        // adjust the new vertex to point more toward the center
        var redirect = centerVector.setLength(
          e1.length() * redirectFactor * v.distanceTo(center) / avgDist
        );
        v1.add(redirect);

        // construct the two new faces
        var face1 = new THREE.Face3();
        face1.a = patchvidx;
        face1.b = patchprevidx;
        face1.c = patchv1idx;
        face1.normal = eprev.clone().cross(e1).normalize();
        patchFaces.push(face1);
        var face2 = face1.clone();
        face2.b = patchv1idx;
        face2.c = patchnextidx;
        face2.normal = e1.clone().cross(enext).normalize();
        patchFaces.push(face2);

        // replace vertex v in the cycle with the new vertex
        cycle[idx] = v1;
        // update edges, angles, and normals
        edges[prevIdx] = v1.clone().sub(vprev);
        edges[idx] = vnext.clone().sub(v1);
        // recalculate normals
        var faceAngle;
        faceAngle = Math.acos(
          edges[prevIdx].clone().normalize().dot(
            v.clone().sub(cycle[prevIdx]).normalize()
          )
        )*2.0;
        normals[prevIdx].multiplyScalar(2*Math.PI-angles[prevIdx])
          .add(face1.normal.clone().multiplyScalar(faceAngle)).normalize();
        normals[idx] = face1.normal.clone().add(face2.normal).normalize();
        faceAngle = Math.acos(
          edges[idx].clone().normalize().dot(
            cycle[nextIdx].clone().sub(v).normalize()
          )
        )*2.0;
        normals[nextIdx].multiplyScalar(2*Math.PI-angles[nextIdx])
          .add(face2.normal.clone().multiplyScalar(faceAngle)).normalize();
        // recalculate angles
        angles[prevIdx] = calculateAngleFromEdges(prevIdx, edges, cycle, normals, n);
        angles[idx] = calculateAngleFromEdges(idx, edges, cycle, normals, n);
        angles[nextIdx] = calculateAngleFromEdges(nextIdx, edges, cycle, normals, n);
      }
      else {
        var v1 = newVerts[0];
        var v2 = newVerts[1];

        // put the vertices into the patch map
        var patchv1idx = vertexMapIdx(patchVertexMap, v1, patchVertices, p);
        var patchv2idx = vertexMapIdx(patchVertexMap, v2, patchVertices, p);

        // new edges
        var e1 = v1.clone().sub(v);
        var e2 = v2.clone().sub(v);

        // adjust the new vertex to point more toward the center
        var redirect;
        redirect = centerVector.setLength(
          e1.length() * redirectFactor * v.distanceTo(center) / avgDist
        );
        v1.add(redirect);
        redirect = centerVector.setLength(
          e2.length() * redirectFactor * v.distanceTo(center) / avgDist
        );
        v1.add(redirect);

        // construct the three new faces
        var face1 = new THREE.Face3();
        face1.a = patchvidx;
        face1.b = patchprevidx;
        face1.c = patchv1idx;
        face1.normal = eprev.clone().cross(e1).normalize();
        patchFaces.push(face1);
        var face2 = face1.clone();
        face2.b = patchv1idx;
        face2.c = patchv2idx;
        face2.normal = e1.clone().cross(e2).normalize();
        patchFaces.push(face2);
        var face3 = face2.clone();
        face3.b = patchv2idx;
        face3.c = patchnextidx;
        face3.normal = e2.clone().cross(enext).normalize();
        patchFaces.push(face3);

        n += 1;
        cycle.splice(idx, 1, v1, v2);
        if (idx==0) prevIdx += 1;
        edges.splice(idx, 1, v2.clone().sub(v1), vnext.clone().sub(v2));
        edges[prevIdx] = v1.clone().sub(vprev);
        var nextnextIdx = (nextIdx+1)%n;
        normals.splice(idx, 1, null, null);
        angles.splice(idx, 1, 0, 0);
        // recalculate normals
        var faceAngle;
        faceAngle = Math.acos(
          edges[prevIdx].clone().normalize().dot(
            v.clone().sub(cycle[prevIdx]).normalize()
          )
        )*2.0;
        normals[prevIdx].multiplyScalar(2*Math.PI-angles[prevIdx])
          .add(face1.normal.clone().multiplyScalar(faceAngle)).normalize();
        normals[idx] = face1.normal.clone().add(face2.normal).normalize();
        normals[nextIdx] = face2.normal.clone().add(face3.normal).normalize();
        faceAngle = Math.acos(
          edges[nextIdx].clone().normalize().dot(
            cycle[nextnextIdx].clone().sub(v).normalize()
          )
        )*2.0;
        normals[nextnextIdx].multiplyScalar(2*Math.PI-angles[nextnextIdx])
          .add(face3.normal.clone().multiplyScalar(faceAngle)).normalize();
        // recalculate angles
        angles[prevIdx] = calculateAngleFromEdges(prevIdx, edges, cycle, normals, n);
        angles[idx] = calculateAngleFromEdges(idx, edges, cycle, normals, n);
        angles[nextIdx] = calculateAngleFromEdges(nextIdx, edges, cycle, normals, n);
        angles[nextnextIdx] = calculateAngleFromEdges(nextnextIdx, edges, cycle, normals, n);
      }
    }

    // we should get here once the cycle only contains three verts; patch the
    // final hole
    if (cycle.length==3) {
      var face = new THREE.Face3();
      face.a = vertexMapIdx(patchVertexMap, cycle[0], patchVertices, p);
      face.b = vertexMapIdx(patchVertexMap, cycle[2], patchVertices, p);
      face.c = vertexMapIdx(patchVertexMap, cycle[1], patchVertices, p);
      var e01 = cycle[1].clone().sub(cycle[0]);
      var e02 = cycle[2].clone().sub(cycle[0]);
      face.normal = e02.cross(e01).normalize();
      patchFaces.push(face);
    }
    // ...but, if we found an infinitely expanding front (the algorithm isn't
    // perfect), we need to remove the faces we added
    else if (cycle.length>3) {
      patchFaces.splice(originalFaceCount);
    }

    // smooth the patch; algorithm looks like this:
    //  1. build an adjacency map for the verts in the patch
    //  2. for every vertex that's not on the boundary of the patch, set its
    //    position to the average of its neighbors
    //  3. iterate this several times
    var vertices = this.patchMesh.geometry.vertices;
    var faces = this.patchMesh.geometry.faces.slice(originalFaceCount);
    var patchAdjacencyMap = this.generateAdjacencyMap(vertices, faces);

    // set cycle to the initial array of border verts
    cycle = borderCycles[c];

    // skip the rest if the hole was triangular
    if (cycle.length<=3) continue;

    // remove verts that are on the border because we won't move them
    for (var key in patchAdjacencyMap) {
      if (cycle.indexOf(patchAdjacencyMap[key].vertex)>-1) {
        delete patchAdjacencyMap[key];
      }
      else {
        // make a copy of neighbor vertices so that every vertex gets updated
        // from its neighbors' original positions
        var data = patchAdjacencyMap[key];
        data.copyNeighbors = data.neighbors.map(function(x) {return x.clone();});
      }
    }

    var numIterations = 20;

    // do a set number of smoothing iterations; could do an adaptive algorithm
    // like "only adjust the vert if its distance to its new position is greater
    // than a threshold", but that seems like overkill as this is cheap
    for (var i=0; i<numIterations; i++) {
      // set each vertex to the average of its neighbors based on copNeighbors
      for (var key in patchAdjacencyMap) {
        var n = patchAdjacencyMap[key].neighbors.length;
        var neighbors = patchAdjacencyMap[key].copyNeighbors;
        var sum = neighbors.reduce(function (acc, x) {
          return acc.add(x);
        }, new THREE.Vector3());
        patchAdjacencyMap[key].vertex.copy(sum.divideScalar(n));
      }

      // skip updating the copy neighbor if no more iterations
      if (i == (numIterations-1)) break;

      // update copy neighbors
      for (var key in patchAdjacencyMap) {
        var data = patchAdjacencyMap[key];
        for (var j=0; j<data.neighbors.length; j++) {
          data.copyNeighbors[j].copy(data.neighbors[j]);
        }
      }
    }

    // vertices have moved, so recalculate normals
    for (var i=0; i<faces.length; i++) {
      var face = faces[i];
      var va = vertices[face.a];
      var vb = vertices[face.b];
      var vc = vertices[face.c];
      face.normal.copy(
        vb.clone().sub(va).cross(vc.clone().sub(va)).normalize()
      );
    }

  }

  function calculateAngleFromEdges(idx, edges, cycle, normals, n) {
    var prevIdx = (idx-1+n)%n;
    // first edge points to previous vert, second edge points to next vert
    var e1 = edges[prevIdx].clone().normalize().multiplyScalar(-1);
    var e2 = edges[idx].clone().normalize();
    var angle = Math.acos(e1.dot(e2));

    // need to check if the vertex is convex, i.e., protruding into the hole,
    // and, if so, subtract the calculated angle from 2pi; because we know the
    // winding order, this is true when the previous edge crossed with the
    // normal has a negative component along the current edge
    if (e1.cross(normals[idx]).dot(e2) > 0) {
      angle = 2.0*Math.PI - angle;
    }

    return angle;
  }

  this.printout.log("Patch generated (shown in green). Accept or cancel the patch.");
}

// build a hash table detailing vertex adjacency
Model.prototype.generateAdjacencyMap = function(vertices, faces, storeWindingOrder, storeNormal) {
  // Will be an object { hash: data }, where data is { vertex, vertices, windingOrder, normal}.
  // For a given vertex, it will have an entry (keyed by hash) and contain an
  // object that stores the vertex, its adjacent vertices, and the count of
  // faces it shares with each adjacent vertex.
  // An important point is that, in a well-formed mesh, each vertex will share
  // exactly two faces with each neighbor.
  var adjacencyMap = {};

  var p = this.p;
  // for each face
  for (var f=0; f<faces.length; f++) {
    var face = faces[f];
    var faceVerts = faceGetVerts(face, vertices);

    // for each vertex in the face
    for (var v=0; v<3; v++) {
      var vertex = faceVerts[v];
      var hash = vertexHash(vertex, p);

      // the other two vertices for the face; we will add these to adjacencyMap
      var vertex1 = faceVerts[(v+1)%3];
      var vertex2 = faceVerts[(v+2)%3];

      if (!(hash in adjacencyMap)) {
        adjacencyMap[hash] = {
          vertex: vertex,
          neighbors: []
        };
        if (storeWindingOrder) adjacencyMap[hash].windingOrder = [];
        if (storeNormal) adjacencyMap[hash].normal = new THREE.Vector3();
      }

      var data = adjacencyMap[hash];
      var normal = face.normal;
      // if winding CCW, store a winding order of 1; if CW, winding order is -1
      addAdjacentVertex(vertex1, data, 1);
      addAdjacentVertex(vertex2, data, -1);

      // weigh the accumulated normal by its angle at the vertex; this should
      // prevent the normal from having a negative component along the adjacent
      // face normals in all reasonable circumstances
      if (storeNormal) {
        data.normal.add(
          normal.clone().multiplyScalar(Math.acos(
            vertex1.clone().sub(vertex).normalize().dot(vertex2.clone().sub(vertex).normalize())
          ))
        );
      }
    }
  }

  // given an existing adjacency set for a given vertex (data), add a new
  // vertex (vertex) that's adjacent to the first one; also pass winding order
  // for the edge from data.vertex to vertex
  function addAdjacentVertex(vertex, data, windingOrder) {
    // hash of the vertex we're adding
    var hash = vertexHash(vertex, p);
    // index of the vertex in the existing adjacency list of data.vertex
    var idx = data.neighbors.indexOf(vertex);
    if (idx==-1) data.neighbors.push(vertex);

    if (storeWindingOrder) {
      // if the vertex we're adding existed in the adjacency list, add to its
      // winding order
      if (idx > -1) data.windingOrder[idx] += windingOrder;
      // if didn't exist, set winding order
      else data.windingOrder.push(windingOrder);
    }
  }

  return adjacencyMap;
}

// make a hash table with vertices that border holes, based on an adjacency map
Model.prototype.generateBorderMap = function(adjacencyMap) {
  if (!adjacencyMap) return null;

  // isolate vertices bordering holes, also store the number of holes adjacent
  // to each vertex
  var borderMap = {};
  for (var key in adjacencyMap) {
    var edgeVertex = false;
    var data = adjacencyMap[key];
    var singleNeighborCount = 0;

    for (var c=0; c<data.windingOrder.length; c++) {
      if (data.windingOrder[c] != 0) {
        edgeVertex = true;
        singleNeighborCount += 1;
      }
    }

    if (edgeVertex) {
      var neighbors = [];
      for (var v=0; v<data.neighbors.length; v++) {
        if (data.windingOrder[v] != 0) neighbors.push(data.neighbors[v]);
      }
      borderMap[key] = {
        vertex: data.vertex,
        neighbors: neighbors,
        // every hole contributes two adjacent vertices with count 1
        numHoles: singleNeighborCount/2,
        normal: data.normal.normalize()
      };
    }
  }

  return borderMap;
}


/* IMPORT AND EXPORT */

// Generate file output representing the model and save it.
Model.prototype.export = function(format, name) {
  var isLittleEndian = this.isLittleEndian;
  var blob;
  var fname;

  if (format=="stl") {
    // this isn't set if we imported a non-STL format
    var stlSize = 84 + 50 * this.count;
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

    dv.setUint32(offset, this.count, isLittleEndian);
    offset += 4;
    for (var tri=0; tri<this.count; tri++) {
      var face = this.faces[tri];

      setVector3(dv, offset, face.normal, isLittleEndian);
      offset += 12;

      for (var vert=0; vert<3; vert++) {
        setVector3(dv, offset, this.vertices[face[faceGetSubscript(vert)]], isLittleEndian);
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
  else if (format=="obj") {
    var out = "";

    out =  "# OBJ exported from Meshy, 0x00019913.github.io/meshy \n";
    out += "# NB: this file only stores faces and vertex positions. \n";
    out += "# number vertices: " + this.vertices.length + "\n";
    out += "# number triangles: " + this.faces.length + "\n";
    out += "#\n";
    out += "# vertices: \n";

    // write the list of vertices
    for (var vert=0; vert<this.vertices.length; vert++) {
      var line = "v";
      var vertex = this.vertices[vert];
      for (var comp=0; comp<3; comp++) line += " " + vertex.getComponent(comp).toFixed(6);
      line += "\n";
      out += line;
    }

    out += "# faces: \n";
    for (var tri=0; tri<this.count; tri++) {
      var line = "f";
      var face = this.faces[tri];
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
}

// Import a model from an STL or OBJ file (any capitalization).
Model.prototype.import = function(file, callback) {
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
      _this.printout.log("Imported file: " + file.name);
    } catch(e) {
      _this.printout.error("Error importing: " + e);
    }
    callback(success);
  };
  if (this.format=="stl") fr.readAsArrayBuffer(file);
  else if (this.format=="obj") fr.readAsText(file);
  else {
    var error = "Format '"+this.format+"' is not supported.";
    this.printout.error(error);
    callback(false);
  }

  var parseResult = function(result) {
    if (_this.format=="stl") {
      // mimicking
      // http://tonylukasavage.com/blog/2013/04/10/web-based-stl-viewing-three-dot-js/
      _this.header = result.slice(0, 80); // store STL header

      var dv = new DataView(result, 80);
      var isLittleEndian = _this.isLittleEndian;

      var n = dv.getUint32(0, isLittleEndian);

      offset = 4;
      _this.vertices = [];
      // for building a unique set of vertices; contains a set of (vertex, idx) pairs;
      // mimics the code found in the THREE.Geometry class
      var vertexMap = {};
      var p = Math.pow(10, _this.vertexPrecision);

      for (var tri=0; tri<n; tri++) {
        var face = new THREE.Face3();

        face.normal = getVector3(dv, offset, isLittleEndian);
        offset += 12;

        for (var vert=0; vert<3; vert++) {
          var vertex = getVector3(dv, offset, isLittleEndian);
          var key = vertexHash(vertex, p);
          var idx = -1;
          if (vertexMap[key]===undefined) {
            idx = _this.vertices.length;
            vertexMap[key] = idx;
            _this.vertices.push(vertex);
          }
          else {
            idx = vertexMap[key];
          }
          face[faceGetSubscript(vert)] = idx;
          offset += 12;
        }

        // ignore "attribute byte count" (2 bytes)
        offset += 2;
        _this.add(face);
      }

      function getVector3(dv, offset, isLittleEndian) {
        return new THREE.Vector3(
          dv.getFloat32(offset, isLittleEndian),
          dv.getFloat32(offset+4, isLittleEndian),
          dv.getFloat32(offset+8, isLittleEndian)
        );
      }
    }
    else if (_this.format=="obj") {
      _this.count = 0;
      _this.vertices = [];
      var len = result.length;
      var hasVertNormals = false;
      var vertexNormals = [];
      var i = 0;
      while (i<len) {
        // get a line from the file string
        var line = getLine();
        if (line.length==0) continue;
        // if vertex, get vertex; relevant flags are 'v' and 'vn'
        if (line[0]=='v') {
          if (line[1]==' ') {
            var vertex = getVector3(line.substring(2));
            _this.vertices.push(vertex);
          }
          else if (line[1]=='n') {
            var normal = getVector3(line.substring(3)).normalize();
            vertexNormals.push(normal);
          }
        }
        // if face, get face
        else if (line[0]=='f') {
          hasVertNormals = (_this.vertices.length==vertexNormals.length);
          var triangles = getTriangles(line.substring(2));
          for (var tri=0; tri<triangles.length; tri++) _this.add(triangles[tri]);
        }
      }

      function getLine() {
        var i0 = i, ri;
        do {
          ri = result[i];
          i++;
        } while (ri!='\n' && i<len);
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
            _this.vertices[polyIndices[0]],
            _this.vertices[polyIndices[2]]
          ).length();
          var d13 = v.subVectors(
            _this.vertices[polyIndices[1]],
            _this.vertices[polyIndices[3]]
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
              _this.vertices[triangle.a],
              _this.vertices[triangle.b]
            );
            var d02 = new THREE.Vector3().subVectors(
              _this.vertices[triangle.a],
              _this.vertices[triangle.c]
            );
            normal.crossVectors(d01, d02);
          }
          normal.normalize();
          triangle.normal = normal;
        }
        return triangles;
      }
    }
  }
}

// Turn off the measurement and delete the THREE.Mesh because these
// wouldn't be automatically disposed of when the Model instance
// disappears.
Model.prototype.dispose = function() {
  if (!this.scene) return;
  this.removePatchMesh();

  // stop any current non-blocking calculations
  this.stopIterator();

  for (var i=this.scene.children.length-1; i>=0; i--) {
    var child = this.scene.children[i];
    if (child.name=="model" || child.name=="targetPlane") {
      this.scene.remove(child);
    }
  }
}

// CODE FOR SLICING - NOT CURRENTLY USING ANY OF THIS, PROBABLY DOESN'T WORK.

// UNUSED, make this workable later.
Model.prototype.renderSlicedModel = function(scene) {
  this.segmentLists = this.slice();
  var geo = new THREE.Geometry();
  for (var i=0; i<this.segmentLists.length; i++) {
    for (var j=0; j<this.segmentLists[i].length; j++) {
      geo.vertices.push(this.segmentLists[i][j][0]);
      geo.vertices.push(this.segmentLists[i][j][1]);
    }
  }
  var mat = new THREE.LineBasicMaterial({
    color: 0x0,
    linewidth: 1
  });
  this.slicedMesh = new THREE.LineSegments(geo, mat);
  this.slicedMesh.name = "model";
  scene.add(this.slicedMesh);
}

// UNUSED.
Model.prototype.buildSliceLists = function() {
  // slice thickness
  this.delta = (this.ymax-this.ymin)/this.numSlices;
  var slice0 = this.ymin + this.delta/2;
  var slicek = this.ymax - this.delta/2;
  var sliceLists = [];
  // initialize sliceLists
  for (var i=0; i<=this.numSlices; i++) {
    sliceLists[i] = [];
  }
  for (var i=0; i<this.count; i++) {
    var index;
    var triangle = this.triangles[i];
    if (triangle.ymin<slice0) index = 0;
    else if (triangle.ymin>slicek) index = this.numSlices;
    else index = Math.floor((triangle.ymin-slice0)/this.delta) + 1;
    sliceLists[index].push(triangle);
  }

  return sliceLists;
}

// UNUSED.
Model.prototype.slice = function() {
  var sliceLists = this.buildSliceLists();
  var sweepList = [];
  var segmentLists = [];

  var intersectingList = [];
  for (var i=0; i<this.numSlices; i++) {
    sweepList = sweepList.concat(sliceLists[i]);
    segmentLists[i] = [];
    var slicePos = this.ymin + (i+0.5)*this.delta;
    for (var j=0; j<sweepList.length; j++) {
      if (sweepList[j].ymax<slicePos) {
        sweepList.splice(j,1); // crude but should work
      }
      else {
        var intersection = sweepList[j].yIntersection(slicePos);
        segmentLists[i].push(intersection);
      }
    }
  }
  return segmentLists;
}
