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
  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;
  this.filename = "";
  this.setVertexPrecision(5);

  // calculated stuff
  this.min = new THREE.Vector3();
  this.max = new THREE.Vector3();
  this.resetBounds(); // sets bounds to Infinity
  this.surfaceArea = null;
  this.volume = null;
  this.centerOfMass = null;
  // octree
  this.octree = null;

  // for display
  this.wireframe = false;
  this.wireframeMesh = null;

  // instance of module responsible for slicing
  this.slicer = null;

  // current mode
  this.mode = "base";

  // meshes

  // base mesh
  this.baseMesh = null;
  this.makeBaseMesh();
  this.matrix = this.baseMesh.matrix.clone();

  // patch mesh
  this.patchMesh = null;

  // support mesh
  this.supportMesh = null;

  // slice meshes
  this.sliceOneLayerBaseMesh = null;
  this.sliceOneLayerContourMesh = null;
  this.sliceOneLayerInfillMesh = null;
  this.sliceAllContourMesh = null;
  this.slicePreviewSlicedMesh = null;
  this.slicePreviewGhostMesh = null;

  // will contain the bounds of distinct components in the geometry (main mesh
  // geometry, patch, supports)
  this.geometryComponents = {};

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

  // for supports
  this.supportGenerator = null;
  this.supportsGenerated = false;

  // currently active non-thread-blocking calculations; each is associated with
  // an iterator and a progress bar and label in the UI
  this.iterators = {};
  this.progressBarContainer = progressBarContainer;
}

Model.Materials = {
  base: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: THREE.FaceColors,
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
  patch: new THREE.MeshStandardMaterial({
    color: 0x44ff44,
    wireframe: false
  }),
  targetPlane: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5
  })
};

// Add a Face3 to the model.
// todo: remove
/*Model.prototype.addFace = function(face) {
  this.faces.push(face);
  this.updateBoundsF(face);
}*/

Model.prototype.computeBounds = function() {
  this.resetBounds();

  var faces = this.baseMesh.geometry.faces;
  var vertices = this.baseMesh.geometry.vertices;

  for (var f = 0; f < faces.length; f++) this.updateBoundsF(faces[f], vertices);
}

// All bounds to Infinity.
Model.prototype.resetBounds = function() {
  this.min.setScalar(Infinity);
  this.max.setScalar(-Infinity);
}

// Update the bounds with a new face.
Model.prototype.updateBoundsF = function(face, vertices) {
  var verts = faceGetVerts(face, vertices);
  for (var i = 0; i < 3; i++) this.updateBoundsV(verts[i]);
}

// Update bounds with a new vertex.
Model.prototype.updateBoundsV = function(v) {
  this.min.min(v);
  this.max.max(v);
}

// Get the bounds as one object.
Model.prototype.getBounds = function() {
  return {
    min: this.min,
    max: this.max
  };
}

Model.prototype.boundCompareMin = function(min) {
  var sx = Math.sign(this.min.x - min.x);
  var sy = Math.sign(this.min.y - min.y);
  var sz = Math.sign(this.min.z - min.z);

  return new THREE.Vector3(sx, sy, sz);
}

Model.prototype.boundCompareMax = function(max) {
  var sx = Math.sign(this.max.x - max.x);
  var sy = Math.sign(this.max.y - max.y);
  var sz = Math.sign(this.max.z - max.z);

  return new THREE.Vector3(sx, sy, sz);
}

// Get a vector representing the coords of the center.
Model.prototype.getCenter = function() {
  return new THREE.Vector3(this.getCenterx(), this.getCentery(), this.getCenterz());
}
// Get individual coords of the center.
Model.prototype.getCenterx = function() { return (this.max.x+this.min.x)/2; }
Model.prototype.getCentery = function() { return (this.max.y+this.min.y)/2; }
Model.prototype.getCenterz = function() { return (this.max.z+this.min.z)/2; }
// Get a list representing the size of the model in every direction.
Model.prototype.getSize = function() {
  return new THREE.Vector3(this.getSizex(), this.getSizey(), this.getSizez());
}
// Get individual sizes of the model.
Model.prototype.getSizex = function() { return (this.max.x-this.min.x); }
Model.prototype.getSizey = function() { return (this.max.y-this.min.y); }
Model.prototype.getSizez = function() { return (this.max.z-this.min.z); }
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
// Return individual mins and maxes.
Model.prototype.getxmin = function() { return this.min.x; }
Model.prototype.getymin = function() { return this.min.y; }
Model.prototype.getzmin = function() { return this.min.z; }
Model.prototype.getxmax = function() { return this.max.x; }
Model.prototype.getymax = function() { return this.max.y; }
Model.prototype.getzmax = function() { return this.max.z; }

Model.prototype.getPolycount = function() {
  return this.baseMesh.geometry.faces.length;
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

/* TRANSFORMATIONS */

Model.prototype.translate = function(pos) {
  var diff = pos.clone().sub(this.baseMesh.position);

  this.baseMesh.position.copy(pos);
  if (this.supportMesh) this.supportMesh.position.copy(pos);
  this.baseMesh.updateMatrix();

  this.min.add(diff);
  this.max.add(diff);

  if (this.centerOfMass) {
    this.centerOfMass.add(diff)
    // transform center of mass indicator
    this.positionTargetPlanes(this.centerOfMass);
  }
}
Model.prototype.translateEnd = function() {
  return;
  var mesh = this.baseMesh;

  mesh.geometry.applyMatrix(mesh.matrix);
  mesh.position.set(0, 0, 0);
  mesh.updateMatrix();
}

Model.prototype.rotate = function(euler) {
  this.baseMesh.rotation.copy(euler);
  this.baseMesh.updateMatrix();
}
Model.prototype.rotateEnd = function() {
  return;
  var mesh = this.baseMesh;

  mesh.geometry.applyMatrix(mesh.matrix);
  mesh.rotation.set(0, 0, 0);
  mesh.updateMatrix();
}

Model.prototype.scale = function(scale) {
  this.baseMesh.scale.copy(scale);
  this.baseMesh.updateMatrix();
}
Model.prototype.scaleEnd = function() {
  return;
  var mesh = this.baseMesh;

  mesh.geometry.applyMatrix(mesh.matrix);
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
}
//// Translate the model on axis ("x"/"y"/"z") by amount (always a Vector3).
// Translate the model to a new position.
/*Model.prototype.translate = function(target) {
  var diff = target.clone().sub(this.baseMesh.position);

  this.baseMesh.position.copy(target);
  if (this.supportMesh) this.supportMesh.position.copy(target);

  this.min.add(diff);
  this.max.add(diff);

  if (this.centerOfMass) {
    this.centerOfMass.add(diff)
    // transform center of mass indicator
    this.positionTargetPlanes(this.centerOfMass);
  }

  return;

  // float precision for printout
  var d = 4;

  // if we're translating on all axes
  if (axis=="all") {
    var amountString = amount.x.toFixed(d)+", "+amount.y.toFixed(d)+", "+amount.z.toFixed(d);
    this.printout.log("translation by ("+amountString+") units on x, y, z");
  }
  // if we're translating on only one axis
  else {
    this.printout.log("translation by "+amount[axis].toFixed(d)+" units on "+axis+" axis");
  }

  // translate vertices
  for (var v=0; v<this.vertices.length; v++) this.vertices[v].add(amount);

  // set tags and clean up

  this.baseMesh.geometry.verticesNeedUpdate = true;
  this.baseMesh.geometry.normalsNeedUpdate = true;
  this.baseMesh.geometry.boundingSphere = null;
  this.baseMesh.geometry.boundingBox = null;

  this.min.add(amount);
  this.max.add(amount);

  if (this.centerOfMass) {
    this.centerOfMass.add(amount)
    // transform center of mass indicator
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  this.removeSupports();
  this.supportGenerator = null;

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  this.measurement.translate(amount);
}*/

// Rotate the model on axis ("x"/"y"/"z") by "amount" degrees.
/*Model.prototype.rotate = function(axis, amount) {
  var degree = amount[axis]*Math.PI/180.0;

  this.printout.log("rotation by "+amount[axis]+" degrees about "+axis+" axis");
  this.resetBounds();
  // need a Vector3 for rotating vertices
  var axisVector = axisToVector3(axis);

  for (var v=0; v<this.vertices.length; v++) {
    var vertex = this.vertices[v];
    vertex.applyAxisAngle(axisVector, degree);
    this.updateBoundsV(vertex);
  }
  for (var f=0; f<this.faces.length; f++) {
    this.faces[f].normal.applyAxisAngle(axisVector, degree);
  }

  this.baseMesh.geometry.verticesNeedUpdate = true;
  this.baseMesh.geometry.normalsNeedUpdate = true;
  this.baseMesh.geometry.boundingSphere = null;
  this.baseMesh.geometry.boundingBox = null;
  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass.applyAxisAngle(axisToVector3(axis),degree);
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  this.removeSupports();
  this.supportGenerator = null;

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  // size argument is necessary for resizing things that aren't rotationally
  // symmetric
  this.measurement.rotate(axis, degree, this.getSize());
}*/

// Scale the model on axis ("x"/"y"/"z") by amount.
/*Model.prototype.scale = function (axis, amount) {
  // float precision for printout
  var d = 4;

  // if we're scaling on all axes
  if (axis=="all") {
    var amountString = amount.x.toFixed(d)+", "+amount.y.toFixed(d)+", "+amount.z.toFixed(d);
    this.printout.log("scale by a factor of ("+amountString+") units on x, y, z");
  }
  // if we're scaling on only one axis
  else {
    var amountString = amount[axis].toFixed(d);
    this.printout.log("scale by a factor of "+amountString+" units on "+axis+" axis");
  }
  for (var v=0; v<this.baseMesh.geometry.vertices.length; v++) {
    this.baseMesh.geometry.vertices[v].multiply(amount);
  }
  // normals may shift as a result of the scaling, so recompute
  this.baseMesh.geometry.computeFaceNormals();

  this.baseMesh.geometry.verticesNeedUpdate = true;
  this.baseMesh.geometry.normalsNeedUpdate = true;
  this.baseMesh.geometry.boundingSphere = null;
  this.baseMesh.geometry.boundingBox = null;
  this.surfaceArea = null;
  this.volume = null;
  this.min.multiply(amount);
  this.max.multiply(amount);
  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass.multiply(amount);
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  this.removeSupports();
  this.supportGenerator = null;

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  this.measurement.scale(amount);
}*/

// Mirror the mesh along an axis.
Model.prototype.mirror = function(axis) {
  this.printout.log("mirror along "+axis+" axis");

  var scaleVector = new THREE.Vector3(1,1,1);
  scaleVector[axis] = -1;
  for (var v=0; v<this.vertices.length; v++) {
    this.vertices[v].multiply(scaleVector);
  }
  // flip the normal component and also flip the winding order
  for (var f=0; f<this.faces.length; f++) {
    var face = this.faces[f];
    var tmp = face.a;
    face.a = face.b;
    face.b = tmp;
    face.normal[axis] *= -1;
  }

  this.baseMesh.geometry.verticesNeedUpdate = true;
  this.baseMesh.geometry.elementsNeedUpdate = true;
  this.baseMesh.geometry.boundingSphere = null;
  this.baseMesh.geometry.boundingBox = null;
  // swap the min/max and negate
  var tmp = this.min[axis];
  this.min[axis] = -1*this.max[axis];
  this.max[axis] = -1*tmp;

  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass[axis] *= -1;
    this.positionTargetPlanes(this.centerOfMass);
  }

  this.removePatchMesh();

  // invalidate the octree and stop any active iterators
  this.octree = null;
  this.stopIterator();

  this.removeSupports();
  this.supportGenerator = null;

  // erase the vertex colors signifying thickness
  this.clearThicknessView();

  this.measurement.scale(scaleVector);
}

Model.prototype.flipNormals = function() {
  // flip the normal component and also flip the winding order
  for (var f=0; f<this.faces.length; f++) {
    var face = this.faces[f];
    var tmp = face.a;
    face.a = face.b;
    face.b = tmp;
    face.normal.multiplyScalar(-1);
  }

  this.baseMesh.geometry.elementsNeedUpdate = true;
  this.baseMesh.geometry.normalsNeedUpdate = true;
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
  for (var i=0; i<this.faces.length; i++) {
    var face = this.faces[i];
    this.surfaceArea += this.faceCalcSurfaceArea(face);
  }
  return this.surfaceArea;
}

// Calculate volume.
Model.prototype.calcVolume = function() {
  this.volume = 0;
  for (var i=0; i<this.faces.length; i++) {
    var face = this.faces[i];
    this.volume += this.faceCalcSignedVolume(face);
  }
}

// Calculate center of mass.
Model.prototype.calcCenterOfMass = function() {
  if (this.centerOfMass) return this.centerOfMass;
  var modelVolume = 0, faceVolume = 0;
  var center = new THREE.Vector3();
  for (var i=0; i<this.faces.length; i++) {
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

  for (var i=0; i<this.faces.length; i++) {
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
  if (this.wireframeMesh === null) this.makeWireframeMesh();

  this.wireframe = !this.wireframe;
  this.printout.log("Wireframe is " + (this.wireframe ? "on" : "off") + ".");

  this.wireframeMesh.visible = this.wireframe;
  //this.baseMesh.material.wireframe = this.wireframe;
}

Model.prototype.makeWireframeMesh = function() {
  var mesh = this.baseMesh.clone();
  mesh.material = Model.Materials.wireframe;
  mesh.visible = false;
  this.scene.add(mesh);

  this.wireframeMesh = mesh;
}

// Get and set material color.
Model.prototype.getMeshColor = function() {
  if (this.baseMesh) return this.baseMesh.material.color.getHex();
}
Model.prototype.setMeshMaterial = function(color, roughness, metalness) {
  var mat = Model.Materials.base;

  mat.color.set(color);
  mat.roughness = roughness;
  mat.metalness = metalness;
}
Model.prototype.setWireframeMaterial = function(color) {
  var mat = Model.Materials.wireframe;

  mat.color.set(color);
}

// Toggle the COM indicator. If the COM hasn't been calculated, then
// calculate it.
Model.prototype.toggleCenterOfMass = function() {
  this.calcCenterOfMass();
  this.showCenterOfMass = !this.showCenterOfMass;
  this.printout.log("Center of mass indicator is "+(this.showCenterOfMass ? "on" : "off")+".");
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
  var planeMat = Model.Materials.targetPlane;
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
  var min = this.min.clone().sub(size);
  var max = this.max.clone().add(size);

  vX[0].set(point.x, min.y, min.z);
  vX[1].set(point.x, min.y, max.z);
  vX[2].set(point.x, max.y, min.z);
  vX[3].set(point.x, max.y, max.z);

  vY[0].set(min.x, point.y, min.z);
  vY[1].set(min.x, point.y, max.z);
  vY[2].set(max.x, point.y, min.z);
  vY[3].set(max.x, point.y, max.z);

  vZ[0].set(min.x, min.y, point.z);
  vZ[1].set(min.x, max.y, point.z);
  vZ[2].set(max.x, min.y, point.z);
  vZ[3].set(max.x, max.y, point.z);

  this.targetPlanes[0].verticesNeedUpdate = true;
  this.targetPlanes[1].verticesNeedUpdate = true;
  this.targetPlanes[2].verticesNeedUpdate = true;
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
    this.makeBaseMesh();
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

Model.prototype.addGeometryComponent = function(name, vstart, vcount, fstart, fcount) {
  var components = this.geometryComponents;
  if (components.hasOwnProperty(name)) this.removeGeometryComponent(name);

  components[name] = {
    vstart: vstart,
    vcount: vcount,
    fstart: fstart,
    fcount: fcount
  };
}

Model.prototype.removeGeometryComponent = function(name) {
  if (!this.geometryComponents.hasOwnProperty(name)) return;

  var component = this.geometryComponents[name];

  this.vertices.splice(component.vstart, component.vcount);
  this.faces.splice(component.fstart, component.fcount);

  this.baseMesh.geometry.verticesNeedUpdate = true;
  this.baseMesh.geometry.elementsNeedUpdate = true;

  delete this.geometryComponents[name];
}

// Create the base mesh (as opposed to another display mode).
// todo: remove
Model.prototype.makeBaseMesh = function() {
  if (!this.baseMesh) {
    var geo = new THREE.Geometry();
    this.baseMesh = new THREE.Mesh(geo, Model.Materials.base);
    this.baseMesh.name = "base";
    this.baseMesh.frustumCulled = false;
  }

  return this.baseMesh;
}
Model.prototype.makeSupportMesh = function() {
  if (!this.supportMesh) {
    var geo = new THREE.Geometry();
    this.supportMesh = new THREE.Mesh(geo, Model.Materials.base);
    this.supportMesh.name = "support";
    this.supportMesh.frustumCulled = false;
  }

  return this.supportMesh;
}
Model.prototype.makePatchMesh = function() {
  if (!this.patchMesh) {
    var geo = new THREE.Geometry();
    this.patchMesh = new THREE.Mesh(geo, Model.Materials.patch);
    this.patchMesh.name = "patch";
    this.patchMesh.frustumCulled = false;
  }

  return this.patchMesh;
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

// TODO: DEPRECATE
// Set the geometry on the current slice mesh.
Model.prototype.setSliceMeshGeometry = function() {
  if (!this.slicer) return;

  var sliceGeometry = this.slicer.getGeometry();

  var sliceVertices = sliceGeometry.vertices;
  var sliceFaces = sliceGeometry.faces;

  if (this.slicer.mode==Slicer.Modes.preview) {
    var mesh = this.sliceFullMesh;
    if (!mesh) return;

    mesh.geometry.vertices = sliceVertices;

    mesh.geometry.verticesNeedUpdate = true;
    mesh.geometry.lineDistancesNeedUpdate = true;
  }
  else if (this.slicer.mode==Slicer.Modes.full) {
    var mesh = this.sliceFullMesh;
    if (!mesh) return;

    mesh.geometry = new THREE.Geometry();
    mesh.geometry.vertices = sliceVertices;

    mesh.geometry.verticesNeedUpdate = true;
    mesh.geometry.lineDistancesNeedUpdate = true;
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
    Model.Materials.sliceOneLayerBase
  );
  mesh.name = "slice";
  mesh.frustumCulled = false;
  this.sliceOneLayerBaseMesh = mesh;

  // make mesh for current layer's print contours
  mesh = new THREE.LineSegments(
    geos.currentLayerContours.geo,
    Model.Materials.sliceOneLayerContour
  );
  mesh.name = "slice";
  mesh.frustumCulled = false;
  this.sliceOneLayerContourMesh = mesh;

  // make mesh for current layer's infill
  mesh = new THREE.LineSegments(
    geos.currentLayerInfill.geo,
    Model.Materials.sliceOneLayerInfill
  );
  mesh.name = "slice";
  mesh.frustumCulled = false;
  this.sliceOneLayerInfillMesh = mesh;

  // make mesh for all non-current layer contours
  mesh = new THREE.LineSegments(
    geos.allContours.geo,
    Model.Materials.sliceAllContours
  );
  mesh.name = "slice";
  mesh.frustumCulled = false;
  this.sliceAllContourMesh = mesh;

  // make mesh for sliced geometry - supports two material indices for making
  // faces visible and invisible
  mesh = new THREE.Mesh(
    geos.slicedMesh.geo,
    [Model.Materials.slicePreviewMeshVisible, Model.Materials.slicePreviewMeshTransparent]
  );
  mesh.name = "slice";
  mesh.frustumCulled = false;
  this.slicePreviewSlicedMesh = mesh;

  // to make the ghost, just clone the base mesh and assign ghost material
  mesh = new THREE.Mesh(geos.source.geo, Model.Materials.slicePreviewMeshGhost);
  mesh.name = "slice";
  mesh.frustumCulled = false;
  this.slicePreviewGhostMesh = mesh;
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

  // create the octree; the last argument means that we will manually fill out
  // the geometry
  this.octree = new Octree(this.baseMesh);


  // fill out the octree in a non-blocking way

  // start by making the iterator
  var iterListEntry = this.makeIterator(
    {
      f: this.octree.addFace.bind(this.octree),
      n: this.faces.length,
      batchSize: clamp(this.faces.length/100, 1, 5000),
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
      batchSize: clamp(this.faces.length/25, 1, 5000),
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

    var faceCenter = faceGetCenter(face, this.vertices);
    var negativeNormal = face.normal.clone().negate();

    var intersection = this.octree.castRayInternal(faceCenter, negativeNormal);

    var dist = 0;
    if (intersection.meshHit) dist = intersection.dist;

    var level = Math.min(dist/threshold, 1.0);
    face.color.setRGB(1.0, level, level);
  }


  function onDone() {
    this.baseMesh.geometry.colorsNeedUpdate = true;

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

  this.baseMesh.geometry.colorsNeedUpdate = true;
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


/* MESH REPAIR */

// take the existing patch geometry and integrate it into the model geometry
Model.prototype.acceptPatch = function() {
  if (!this.patchMesh) return;

  var vertices = this.patchMesh.geometry.vertices;
  var faces = this.patchMesh.geometry.faces;

  var baseGeo = this.baseMesh.geometry;
  var bvertices = baseGeo.vertices;
  var bfaces = baseGeo.faces;
  var vstart = bvertices.length;
  var fstart = bfaces.length;

  var vertexMap = {};
  var p = this.p;

  // add the model's existing verts into the map in order to be able to detect
  // shared vertices between the model and patch
  vertexArrayToMap(vertexMap, bvertices, p);

  // clone each face and update its indices into the vertex array
  for (var f=0; f<faces.length; f++) {
    var face = faces[f].clone();
    face.a = vertexMapIdx(vertexMap, vertices[face.a], bvertices, p);
    face.b = vertexMapIdx(vertexMap, vertices[face.b], bvertices, p);
    face.c = vertexMapIdx(vertexMap, vertices[face.c], bvertices, p);
    baseGeo.faces.push(face);
  }
  baseGeo.verticesNeedUpdate = true;
  baseGeo.elementsNeedUpdate = true;

  this.printout.log("Mesh patched.");

  this.removePatchMesh();

  return;

  // record the starts and counts for the added patch geometry
  this.addGeometryComponent(
    "patch",
    vstart,
    this.vertices.length - vstart,
    fstart,
    this.faces.length - fstart
  );
}

Model.prototype.cancelPatch = function() {
  if (!this.patchMesh) return;

  this.removePatchMesh();
  this.printout.log("Patch canceled.");
}

// remove the patch and clear associated data
Model.prototype.removePatchMesh = function() {
  this.patchMesh = null;

  removeMeshByName(this.scene, "patch");
}

// the algorithm is like this:
//  1. generate an adjacency map
//  2. from the adjacency map, get the hash table of vertices that border holes
//  3. generate a list of border vertex cycles (wind them clockwise)
//  4. use the advancing front mesh (AFM) method to fill the holes
Model.prototype.generatePatch = function() {
  // remove any existing patch
  this.removePatchMesh();

  // get the hash table detailing vertex adjacency
  var adjacencyMap = this.generateAdjacencyMap(
    this.baseMesh.geometry.vertices,
    this.baseMesh.geometry.faces,
    true, true
  );

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
  var patchMesh = this.makePatchMesh();
  var patchGeo = patchMesh.geometry;
  patchGeo.vertices = patchVertices;
  patchGeo.faces = patchFaces;
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


/* SUPPORTS */

Model.prototype.generateSupports = function(params) {
  this.removeSupports();

  if (!this.supportGenerator) {
    this.supportGenerator = new SupportGenerator(this.baseMesh);
  }

  // add mesh min and max to the params and pass them to the support generator
  Object.assign(params, {
    min: this.min,
    max: this.max
  });

  var supportMesh = this.makeSupportMesh();
  supportMesh.geometry = this.supportGenerator.generate(params);
  this.scene.add(supportMesh);
  this.supportsGenerated = true;

  return;

  var geometry = this.baseMesh.geometry;

  this.addGeometryComponent(
    "support",
    this.vertices.length,
    supportGeometry.vertices.length,
    this.faces.length,
    supportGeometry.faces.length
  );

  geometry.merge(supportGeometry);
  geometry.verticesNeedUpdate = true;
  geometry.elementsNeedUpdate = true;
}

Model.prototype.removeSupports = function() {
  if (this.supportGenerator) this.supportGenerator.cleanup();

  this.supportsGenerated = false;
  this.supportMesh = null;
  removeMeshByName(this.scene, "support");

  return;

  this.removeGeometryComponent("support");
}


/* SLICING */

// Turn on slice mode: set mode to "slice", passing various params. Slice mode
// defaults to preview.
Model.prototype.activateSliceMode = function(params) {
  this.setMode("slice", params);
}

// Turn off slice mode: set mode to "base".
Model.prototype.deactivateSliceMode = function() {
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
Model.prototype.export = function(format, name) {
  var isLittleEndian = this.isLittleEndian;
  var blob;
  var fname;
  var count = this.faces.length;

  var geo = this.baseMesh.geometry;
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
}

// Import a model from an STL or OBJ file (any capitalization).
Model.prototype.import = function(file, params, callback) {
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

      /*// record where the main geometry begins
      var vcount = _this.baseMesh.geometry.vertices.length;
      var fcount = _this.baseMesh.geometry.faces.length;
      _this.addGeometryComponent("model", 0, vcount, 0, fcount);*/

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

    //todo: store geometry
    _this.baseMesh.geometry = geo;
    _this.computeBounds();

    var t = performance.now();
    var octree = new Octree(_this.baseMesh);
    console.log(performance.now() - t);
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

  removeMeshByName(this.scene, "base");
  removeMeshByName(this.scene, "slice");
  removeMeshByName(this.scene, "targetPlane");

  // remove measurement markers, etc. from the scene
  this.measurement.dispose();
}
