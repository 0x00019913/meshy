// Builds an array of unique vertices. Presence in the array is tested by a hash
// map that partitions the space within the given bounds into an n-by-n-by-n
// grid of sectors; each sector is a list of vertices located in it, organized
// as a { vector, idx } object, where "vector" is a reference to the vector (for
// equality comparisons) and "idx" is the index in the "vertices" array.

function Vector3ArrayBuilder(n, bounds, vertices) {
  this.n = n;
  this.xmin = bounds.xmin;
  this.xmax = bounds.xmax;
  this.ymin = bounds.ymin;
  this.ymax = bounds.ymax;
  this.zmin = bounds.zmin;
  this.zmax = bounds.zmax;
  this.vertices = vertices;

  this.dx = (this.xmax-this.xmin)/n;
  this.dy = (this.ymax-this.ymin)/n;
  this.dz = (this.zmax-this.zmin)/n;

  // for comparing vector equality
  this.epsilon = 0.000001;

  this.hashMap = [];
}

// 1. takes THREE.Vector3 v,
// 2. checks if v exists in the vertices array; if so, returns its index,
// 2. else, pushes it onto the vertices array,
// 3. returns index i s.t. vertices[i] equals v
Vector3ArrayBuilder.prototype.idx = function(v) {
  var bucket = this.hashMap;
  var xi = this.xIdx(v);
  if (bucket[xi]===undefined) bucket[xi] = [];
  bucket = bucket[xi];
  var yi = this.yIdx(v);
  if (bucket[yi]===undefined) bucket[yi] = [];
  bucket = bucket[yi];
  var zi = this.zIdx(v);
  if (bucket[zi]===undefined) bucket[zi] = [];
  bucket = bucket[zi];

  for (var i=0; i<bucket.length; i++) {
    var hashEntry = bucket[i];
    if (this.vEqual(v,hashEntry.vector)) {
      return hashEntry.idx;
    }
  }

  // fell through the end of the loop - means the vertex isn't in the array yet
  var idx = this.vertices.length;
  this.vertices.push(v);
  bucket.push({ vector: v, idx: idx });
  return idx;
}

// returns x-index in the hash map
Vector3ArrayBuilder.prototype.xIdx = function(v) {
  return Math.floor((v.x-this.xmin)/this.dx);
}
// returns y-index in the hash map
Vector3ArrayBuilder.prototype.yIdx = function(v) {
  return Math.floor((v.y-this.ymin)/this.yx);
}
// returns z-index in the hash map
Vector3ArrayBuilder.prototype.zIdx = function(v) {
  return Math.floor((v.z-this.zmin)/this.dz);
}
// tests for equality between scalars
Vector3ArrayBuilder.prototype.sEqual = function(a, b) {
  return (Math.abs(a-b) < this.epsilon);
}
// tests for equality between vectors
Vector3ArrayBuilder.prototype.vEqual = function(a, b) {
  return (this.sEqual(a.x,b.x) && this.sEqual(a.y,b.y) && this.sEqual(a.z,b.z));
}
