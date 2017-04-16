/* model.js
   classes:
    Model
   description:
    Represents a discrete model corresponding to one loaded OBJ or STL
    file. Has transformation functions, associated bounds that are
    recalculated on transformation, methods to do calculations, methods
    to upload and export.
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
  this.adjacencyMap = null;
  this.patchMat = new THREE.MeshStandardMaterial({
    color: 0x44ff44,
    wireframe: false
  });
  this.patchMesh = null;

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
  // sets the scale for measurement markers and the cursor
  this.measurement.setScale(this.getMaxSize() * 0.4);
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
  this.measurement.setScale(this.getMaxSize() * 0.4);

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

/* MESH REPAIR */
// take the existing patch geometry and integrate it into the model geometry
Model.prototype.acceptPatch = function() {
  this.adjacencyMap = null;
}

// remove the patch and clear associated data
Model.prototype.cancelPatch = function() {
  if (this.patchMesh) {
    this.patchMesh = null;
    this.adjacencyMap = null;

    if (!this.scene) return;
    for (var i=this.scene.children.length-1; i>=0; i--) {
      var child = this.scene.children[i];
      if (child.name=="patch" || child.name=="borderVerts") this.scene.remove(child);
    }
  }
}

// the algorithm is like this:
//  1. generate or retrieve an adjacency map
//  2. from the adjacency map, get the hash table of vertices that border holes
//  3. minimally patch border vertices to make every vert only border one hole
//  4. generate a list of border vertex cycles (wind them clockwise)
//  5. use the advanding front mesh (AFM) method to fill the holes
Model.prototype.generatePatch = function(patchSteps) {
  // remove any existing patch
  this.cancelPatch();

  // get the hash table detailing vertex adjacency
  if (!this.adjacencyMap) this.adjacencyMap = this.generateAdjacencyMap();
  var adjacencyMap = this.adjacencyMap;

  // vertex precision factor
  var p = this.p;

  // from the adjacency map, get a hash table containing only border vertices
  var borderMap = this.generateBorderMap(adjacencyMap);

  // check for empty border map; if properties exist, then holes exist
  if (objectIsEmpty(borderMap)) {
    this.printout.log("This mesh does not contain holes.");
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

  /* for visualizing verts */
  var borderGeo = new THREE.Geometry();
  var borderMat = new THREE.PointsMaterial({color: 0xff0000, size: 0.04});
  var borderMesh = new THREE.Points(borderGeo, borderMat);
  borderMesh.name = "borderVerts";
  this.scene.add(borderMesh);

  // patch all vertices bordering more than one hole
  patchMultipleHoleVerts();

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
    // nothing failed in our initial patching step, this should always pick a
    // vertex on the first iteration because every vertex will now border only
    // one hole
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

      // hash current vertex to find its neighbors
      var hash = vertexHash(current, p);

      // get the vertex's two neighbors
      var neighbors = borderMap[hash].neighbors;
      var normal = borderMap[hash].normal;
      delete borderMap[hash];

      // store vertex in the cycle
      cycle.push(current);
      cycleNormals.push(normal);

      // neighbor count should always be 2 (unless a vertex shares holes, but
      // that should never be true for the current vertex by design)
      if (neighbors.length!=2) break;

      // if we're on the first vertex, need to wind the cycle in a consistent
      // direction (CW here) to make face generation easier
      if (previous==null) {
        // two adjacent verts ("vc" and "vn") on the border must certainly have
        // a vert ("va") that's adjacent to both; if ((vn-vc) x normal) has a
        // negative component along an edge to va, then we're winding CW; else,
        // take the other neighbor to be the next vertex
        var next = neighbors[0];
        var edge = next.clone().sub(current);
        // using the normal of the current vert, not of the next; shouldn't make
        // a difference as the normal can't flip sign w.r.t. the normals of its
        // adjacent faces on just one vert
        var cross = edge.cross(normal);
        // get the common adjacent vert of current and next
        var adjacentVertex = null;
        var currentAdjacent = adjacencyMap[vertexHash(current, p)].vertices;
        var nextAdjacent = adjacencyMap[vertexHash(next, p)].vertices;
        for (var i=0; i<nextAdjacent.length; i++) {
          var n = nextAdjacent[i];
          if (n!=current && currentAdjacent.indexOf(n)>-1) {
            adjacentVertex = n;
            break;
          }
        }
        // if the two border verts don't share a vert, something went wrong
        if (adjacentVertex==null) break;

        // if not clockwise, replace next with current's other neighbor
        if (cross.dot(adjacentVertex.clone().sub(current))>0) {
          next = neighbors[1];
        }

        previous = current;
        current = next;
      }
      // else, just pick the neighbor that isn't the previous vert
      else {
        var tmp = current;
        // if first element of neighbors is previous vertex, next vertex has to
        // be the other one; similarly if second element is previous vertex
        current = neighbors[0];
        if (current==previous) current = neighbors[1];
        previous = tmp;
      }

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
    var cycle = borderCycles[c];
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
    var limit = patchSteps;

    // while the cycle of border edges can't be bridged by a single triangle,
    // add or remove vertices by the advancing front mesh method
    while (cycle.length>3) {
      count++;
      if (count > limit) break;
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
      var e1 = cycle[1].clone().sub(cycle[0]);
      var e2 = cycle[2].clone().sub(cycle[0]);
      face.normal = e2.cross(e1).normalize();
      patchFaces.push(face);
    }
    // ...but, if we found an infinitely expanding front (the algorithm isn't
    // perfect), we need to remove the faces we added
    else if (cycle.length>3 && !patchSteps) {
      patchFaces.splice(originalFaceCount);
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

  function patchMultipleHoleVerts() {
    // must first minimally patch the holes such that no vertex borders more than
    // one hole; this will make finding loops of border edges easy
    for (var key in borderMap) {
      var data = borderMap[key];
      // if vertex borders multiple holes, need to patch
      if (data.numHoles>1) {
        // source vertex
        var vertex = data.vertex;
        // border neighbors of source vertex
        var neighbors = data.neighbors;
        // all neighbors, not just the border neighbors; need this for telling if
        // verts are connected by a path
        var adjacent = adjacencyMap[vertexHash(vertex, p)].vertices;
        // edges from the given vertex to its neighbors
        var edges = neighbors.map(function(x) {return vertex.clone().sub(x).normalize();});

        // find all one-triangle holes bordering the vertex; fill them immediately
        while (true) {
          var foundTriangleHole = false;
          for (var i=0; i<neighbors.length; i++) {
            for (var j=0; j<i; j++) {
              var ni = neighbors[i];
              var nj = neighbors[j];
              var nihash = vertexHash(ni, p);
              var niAdjacencyData = adjacencyMap[nihash];
              // find nj among ni's adjacent verts
              var njidx = niAdjacencyData.vertices.indexOf(nj);
              // if nj adjacent to ni and they border a hole (count is 1, whereas,
              // if bordering a triangle, count would be 2), fill them and remove
              // both ni and nj from neighbors array
              if (njidx>-1 && niAdjacencyData.counts[njidx]==1) {
                foundTriangleHole = true;

                var nidata = borderMap[nihash];
                var njhash = vertexHash(nj, p);
                var njdata = borderMap[njhash];

                var nineighbors = nidata.neighbors;
                var njneighbors = njdata.neighbors;

                // insert triangle patch
                triPatchFromIdxPair(data, [i, j], neighbors);

                // check i's number of holes; if i still borders another hole,
                // decrement the number and remove vertex and j from its
                // neighbors; if i now borders zero holes, remove it from the
                // border map
                if (nidata.numHoles>1) {
                  nidata.numHoles -= 1;
                  nineighbors.splice(nineighbors.indexOf(nj), 1);
                  nineighbors.splice(nineighbors.indexOf(vertex), 1);
                }
                else delete borderMap[nihash];

                // ditto for j
                if (njdata.numHoles>1) {
                  njdata.numHoles -= 1;
                  njneighbors.splice(njneighbors.indexOf(ni), 1);
                  njneighbors.splice(njneighbors.indexOf(vertex), 1);
                }
                else delete borderMap[njhash];

                // ditto for the original vertex
                // (removal from neighbors array happens regardless because the
                // future iterations of this loop depend on its length)
                neighbors.splice(neighbors.indexOf(ni), 1);
                neighbors.splice(neighbors.indexOf(nj), 1);
                if (data.numHoles>1) {
                  data.numHoles -= 1;
                }
                else delete borderMap[key];

                break;
              }
            }
            // if found a hole, break out of i loop and try to find more holes
            if (foundTriangleHole) break;
          }

          // didn't find any holes, stop the loop
          if (!foundTriangleHole) break;
        }

        // if all adjacent holes got patched by our one-triangle hole check,
        // then we stop working on this vertex
        if (neighbors.length==0) continue;

        // make a list of pairs of indices for vertex's neighbors that aren't
        // connected by a path of edges; these will be candidates for the minimal
        // patching
        var pairs = [];
        // matrix of angles between two edges
        var angles = [];
        for (var i=0; i<neighbors.length; i++) {
          angles.push([]);
          for (var j=0; j<i; j++) {
            angles[i].push(Math.acos(edges[i].dot(edges[j])));
            var ijConnected = false;
            // check if neighbor i and neighbor j are connected by a path of
            // vertices that are also connected to the source vertex; if so,
            // don't add them to the list of pairs
            var start = neighbors[i];
            var current = start;
            var previous = null;
            while (current) {
              var chash = vertexHash(current, p);
              var cadjacent = adjacencyMap[chash].vertices;
              var next = null;
              for (var n=0; n<cadjacent.length; n++) {
                var cneighbor = cadjacent[n];
                // check that cneighbor adjacent to main vertex and is not
                if (adjacent.indexOf(cneighbor)>-1 && cneighbor != previous) {
                  previous = current;
                  next = cneighbor;
                  break;
                }
              }

              current = next;
              if (current==neighbors[j]) {
                ijConnected = true;
                break;
              }
            }

            if (!ijConnected) pairs.push([i,j]);
          }
        }

        // get pairs with the lowest angles between them
        pairs.sort(function(p1, p2) {
          var angle1 = angles[p1[0]][p1[1]];
          var angle2 = angles[p2[0]][p2[1]];
          return angle1 - angle2;
        });

        // draw new faces to bridge the vertex's connection with
        // data.numHoles-1 of the holes it borders; after adding the new faces,
        // need to alter the borderMap to reflect the new state of connectivity
        // for the vertices that are adjacent to the new face
        for (var i=0; i<data.numHoles-1; i++) {
          var pair = pairs[i];
          // pair should always exist, bugs notwithstanding
          if (!pair) continue;
          triPatchFromIdxPair(data, pair, neighbors);

          // clean up the neighbor data given the new connection:

          // for the two newly connected verts, replace the source vert in
          // their neighbors array with a connection to each other
          var v = [];
          for (var j=0; j<2; j++) {
            v[j] = neighbors[pair[j]];
            var vhash = vertexHash(v[j], p);
            var vdata = borderMap[vhash];
            // LHS is reference to the source vertex in v's neighbors array,
            // RHS is the vertex to which we just connected v
            // for each of the two, we're replacing the source vertex with the
            // other one
            vdata.neighbors[vdata.neighbors.indexOf(vertex)] = neighbors[pair[(j+1)%2]];
          }

          // remove the vertex we just connected from the source vertex's
          // neighbors array in the border map
          neighbors.splice(neighbors.indexOf(v[0]),1);
          neighbors.splice(neighbors.indexOf(v[1]),1);
        }
        // we have ensured that the source vertex only borders one hole
        data.numHoles = 1;
      }
    }

    function triPatchFromIdxPair(data, pair, neighbors) {
      var vertex = data.vertex;

      var face = new THREE.Face3();
      for (var j=0; j<3; j++) {
        // get the right vertex (the source vertex or one of its neighbors)
        var v;
        if (j<2) v = neighbors[pair[j]];
        else v = vertex;

        // get the index for v, adding it to patchVertices if necessary
        var vidx = vertexMapIdx(patchVertexMap, v, patchVertices, p);
        face[faceGetSubscript(j)] = vidx;
      }

      var v1 = neighbors[pair[0]], v2 = neighbors[pair[1]];
      // set the face normal to the cross product of two of its edges, then
      // negate it if we got the sign wrong (correct sign is determined by
      // any of its three vertex normals)
      face.normal = new THREE.Vector3();
      face.normal.crossVectors(
        vertex.clone().sub(v1),
        vertex.clone().sub(v2)
      ).normalize();
      face.normal.multiplyScalar(Math.sign(face.normal.dot(data.normal)));

      // knowing the normal, we can correct the winding order if necessary:
      // presently, face.a is v1, face.b is v2, and face.c is vertex, and we
      // need ()(v2-v1) x normal) to have a positive component along
      // (v1-vertex); if this is not true, flip face.a and face.b
      if (v2.clone().sub(v1).cross(face.normal).dot(v1.clone().sub(vertex))<0) {
        var tmp = face.a;
        face.a = face.b;
        face.b = tmp;
      }

      // finally, store the face
      patchFaces.push(face);
    }
  }
}

// build a hash table detailing vertex adjacency
Model.prototype.generateAdjacencyMap = function() {
  // Will be an object { hash: data }, where data is { vertex, vertices, counts}.
  // For a given vertex, it will have an entry (keyed by hash) and contain an
  // object that stores the vertex, its adjacent vertices, and the count of
  // faces it shares with each adjacent vertex.
  // An important point is that, in a well-formed mesh, each vertex will share
  // exactly two faces with each neighbor.
  var adjacencyMap = {};

  var p = this.p;
  // for each face
  for (var f=0; f<this.faces.length; f++) {
    var face = this.faces[f];
    var faceVerts = faceGetVerts(face, this.vertices);

    // for each vertex in the face
    for (var v=0; v<3; v++) {
      var vertex = faceVerts[v];
      var hash = vertexHash(vertex, p);

      // the other two vertices for the face; we will add these to adjacencyMap
      var vertex1 = (v==0) ? faceVerts[1] : faceVerts[0];
      var vertex2 = (v==2) ? faceVerts[1] : faceVerts[2];

      if (!(hash in adjacencyMap)) {
        adjacencyMap[hash] = {
          vertex: vertex,
          vertices: [],
          counts: [],
          normal: new THREE.Vector3()
        };
      }

      var data = adjacencyMap[hash];
      addAdjacentVertex(vertex1, data);
      addAdjacentVertex(vertex2, data);

      data.normal.add(face.normal);
    }
  }

  // given an existing adjacency set for a given vertex (mapRow), add a new
  // vertex (vertex) that's adjacent to the first one
  function addAdjacentVertex(vertex, mapRow) {
    // hash of the vertex we're adding
    var hash = vertexHash(vertex, p);
    // index of matching vertex
    var idx = -1;

    // for each vertex in the existing adjacency list
    for (var v=0; v<mapRow.vertices.length; v++) {
      // get hash for the other vertex; "hashp" means "hash prime" :P
      var hashp = vertexHash(mapRow.vertices[v], p);
      // if the vertex we're adding is found in the existing adjacency list,
      // set index and stop searching
      if (hashp==hash) {
        idx = v;
        break;
      }
    }

    // if the vertex we're adding exists in the adjacency list, update count
    if (idx > -1) {
      mapRow.counts[idx] += 1;
    }
    // if not found, append vertex and set its count to 1
    else {
      mapRow.vertices.push(vertex);
      mapRow.counts.push(1);
    }
  }

  return adjacencyMap;
}

// make a hash table with vertices that border holes, based on an adjacency map
Model.prototype.generateBorderMap = function(adjacencyMap) {
  if (!adjacencyMap) adjacencyMap = this.adjacencyMap;
  if (!adjacencyMap) adjacencyMap = this.generateAdjacencyMap();

  // isolate vertices bordering holes, also store the number of holes adjacent
  // to each vertex
  var borderMap = {};
  for (var key in adjacencyMap) {
    var edgeVertex = false;
    var data = adjacencyMap[key];
    var singleNeighborCount = 0;

    for (var c=0; c<data.counts.length; c++) {
      if (data.counts[c] == 1) {
        edgeVertex = true;
        singleNeighborCount += 1;
      }
    }

    if (edgeVertex) {
      var neighbors = [];
      for (var v=0; v<data.vertices.length; v++) {
        if (data.counts[v]==1) neighbors.push(data.vertices[v]);
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
Model.prototype.upload = function(file, callback) {
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
      _this.printout.log("Uploaded file: " + file.name);
    } catch(e) {
      _this.printout.error("Error uploading: " + e);
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
