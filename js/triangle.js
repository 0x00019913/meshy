function Triangle(vertices) {
  this.vertices = vertices;
  this.indices = [];
  this.normal = null;
  this.resetBounds();
  this.count = 0;
  this.surfaceArea = null;
  this.signedVolume = null;
}

Triangle.prototype.addVertex = function(idx) {
  if (this.count>=3) {
    console.log("ERROR: tried to push a fourth vertex onto a triangle");
    return;
  }
  this.indices.push(idx);
  var vertex = this.vertices[idx];
  this.count++;
  if (this.count==1) {
    this.xmin = vertex.x;
    this.xmax = vertex.x;
    this.ymin = vertex.y;
    this.ymax = vertex.y;
    this.zmin = vertex.z;
    this.zmax = vertex.z;
  }
  else {
    this.updateBoundsV(vertex);
  }
};

Triangle.prototype.resetBounds = function() {
  this.xmin = Infinity;
  this.xmax = -Infinity;
  this.ymin = Infinity;
  this.ymax = -Infinity;
  this.zmin = Infinity;
  this.zmax = -Infinity;
}
Triangle.prototype.updateBoundsV = function(vertex) {
  this.xmin = vertex.x<this.xmin ? vertex.x : this.xmin;
  this.xmax = vertex.x>this.xmax ? vertex.x : this.xmax;
  this.ymin = vertex.y<this.ymin ? vertex.y : this.ymin;
  this.ymax = vertex.y>this.ymax ? vertex.y : this.ymax;
  this.zmin = vertex.z<this.zmin ? vertex.z : this.zmin;
  this.zmax = vertex.z>this.zmax ? vertex.z : this.zmax;
}
Triangle.prototype.updateBounds = function() {
  this.resetBounds();
  for (var i=0; i<3; i++) {
    this.updateBounds(this.triangles[this.indices[i]]);
  }
}

Triangle.prototype.setNormal = function(normal) {
  this.normal = normal;
};

/*Triangle.prototype.translate = function(axis, amount) {
  for (var i=0; i<3; i++) {
    var vertex = this.vertices[i];
    vertex[axis] += amount;
  }
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;
}

Triangle.prototype.rotate = function(axis, amount) {
  this.resetBounds();
  var axisVector = axisToVector3Map[axis];
  for (var i=0; i<3; i++) {
    var vertex = this.vertices[i];
    vertex.applyAxisAngle(axisVector, amount);
    this.updateBounds(vertex);
  }
  this.normal.applyAxisAngle(axisVector, amount);
}

Triangle.prototype.scale = function(axis, amount) {
  for (var i=0; i<3; i++) {
    var vertex = this.vertices[i];
    vertex[axis] *= amount;
  }
  this[axis+"min"] *= amount;
  this[axis+"max"] *= amount;
}*/

// Calculate triangle area via cross-product.
Triangle.prototype.calcSurfaceArea = function() {
  if (this.surfaceArea!==null) return this.surfaceArea;
  var v = new THREE.Vector3();
  var v2 = new THREE.Vector3();
  v.subVectors(this.vertices[this.indices[0]], this.vertices[this.indices[1]]);
  v2.subVectors(this.vertices[this.indices[0]], this.vertices[this.indices[2]]);
  v.cross(v2);
  this.surfaceArea = 0.5 * v.length();
  return this.surfaceArea;
}

// Calculate the volume of a tetrahedron with one vertex on the origin and
// with the triangle forming the outer face; sign is determined by the inner
// product of the normal with any of the vertices.
Triangle.prototype.calcSignedVolume = function() {
  if (this.signedVolume!==null) return this.signedVolume;
  var sign = Math.sign(this.vertices[this.indices[0]].dot(this.normal));
  var v1 = this.vertices[this.indices[0]];
  var v2 = this.vertices[this.indices[1]];
  var v3 = this.vertices[this.indices[2]];
  var volume = (-v3.x*v2.y*v1.z + v2.x*v3.y*v1.z + v3.x*v1.y*v2.z);
  volume += (-v1.x*v3.y*v2.z - v2.x*v1.y*v3.z + v1.x*v2.y*v3.z);
  this.signedVolume = sign * Math.abs(volume/6.0);
  return this.signedVolume;
}

// Calculate endpoints of segment formed by the intersection of this triangle
// and a plane normal to the y-axis.
// TODO: generalize to any axis
Triangle.prototype.yIntersection = function(planePos) {
  var segment = [];
  for (var i=0; i<3; i++) {
    var v1 = this.vertices[this.indices[i]];
    var v2 = this.vertices[this.indices[(i+1)%3]];
    if ((v1.y<planePos && v2.y>planePos) || (v1.y>planePos && v2.y<planePos)) {
      var dy = v2.y-v1.y;
      if (dy==0) return;
      var factor = (planePos-v1.y)/dy;
      var x = v1.x + (v2.x-v1.x)*factor;
      var z = v1.z + (v2.z-v1.z)*factor;
      segment.push(new THREE.Vector3(x,planePos,z));
    }
  }
  if (segment.length!=2) console.log("strange segment length: ", segment);
  return segment;
}
