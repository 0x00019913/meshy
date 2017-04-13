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
function Model(scene, camera, container, printout, infoOutput) {
  // internal geometry
  this.faces = [];
  this.vertices = [];
  this.count = 0; // count of faces; used more often than count of vertices
  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;
  this.filename = "";
  this.vertexPrecision = 5;

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

  this.measurement = new Measurement(this.scene, this.camera, this.container, this.printout);
  this.measurement.setOutput(this.infoOutput);
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

// Get THREE.Face3 subscript ('a', 'b', or 'c') for a given 0-2 index.
Model.prototype.faceGetSubscript = function(idx) {
  return (idx==0) ? 'a' : ((idx==1) ? 'b' : 'c');
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
  var crossSectionArea = 0;
  var segments = [];
  for (var i=0; i<this.count; i++) {
    var face = this.faces[i];
    var segment = this.faceIntersection(face, axis, pos);
    if (segment && segment.length==2) {
      segments.push(segment);
      // Algorithm is like this:
      // 1. shift segment endpoints down to 0 on axis,
      // 2. calculate area of the triangle formed by segment and origin,
      // 3. multiply by sign, accumulate for all triangles
      segment[0][axis] = 0;
      segment[1][axis] = 0;
      var area = segment[0].cross(segment[1]).multiplyScalar(1/2).length();
      var sign = Math.sign(segment[1].dot(face.normal));
      crossSectionArea += sign * area;
    }
  }

  return crossSectionArea;
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
    color: 0xffffff
  });
  this.plainMesh = new THREE.Mesh(geo, mat);
  this.plainMesh.name = "model";
  this.plainMesh.frustumCulled = false;
  scene.add(this.plainMesh);
}

// use the geometry to build an octree; this is quite computationally expensive
Model.prototype.buildOctree = function(d) {
  // heuristic is that the tree should be as deep as necessary to have 1-10 faces
  // per leaf node so as to make raytracing cheap; the effectiveness will vary
  // between different meshes, of course, but I estimate that ln(polycount)*0.6
  // should be good
  var depth = (d===undefined) ? Math.round(Math.log(this.count)*0.6) : d;

  var size = this.getSize();
  // find largest dimension
  var largestBoundAxis = "x";
  if (size.y>size[largestBoundAxis]) largestBoundAxis = "y";
  if (size.z>size[largestBoundAxis]) largestBoundAxis = "z";
  // make octree 1.1 times as large as largest dimension
  var largestSize = size[largestBoundAxis] * 1.1;
  // center octree on model
  var origin = this.getCenter().subScalar(largestSize/2);

  this.octree = new Octree(depth, origin, largestSize, this.faces, this.vertices, this.scene);
  // add geometry
  //this.octree.addGeometry(this.plainMesh.geometry.faces, this.plainMesh.geometry.vertices)
}

Model.prototype.getMeshColor = function() {
  if (this.plainMesh) return this.plainMesh.material.color.getHex();
}
Model.prototype.setMeshColor = function(color) {
  if (this.plainMesh) return this.plainMesh.material.color.set(color);
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
        setVector3(dv, offset, this.vertices[face[this.faceGetSubscript(vert)]], isLittleEndian);
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
        line += " " + (face[this.faceGetSubscript(vert)]+1);
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
          var key = Math.round(vertex.x*p)+'_'+Math.round(vertex.y*p)+'_'+Math.round(vertex.z*p);
          var idx = -1;
          if (vertexMap[key]===undefined) {
            idx = _this.vertices.length;
            vertexMap[key] = idx;
            _this.vertices.push(vertex);
          }
          else {
            idx = vertexMap[key];
          }
          face[_this.faceGetSubscript(vert)] = idx;
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
            triangle[_this.faceGetSubscript(j)] = triIndices[tri][j];
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
  this.measurement.deactivate();
  if (!this.scene) return;
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
