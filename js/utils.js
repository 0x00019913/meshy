/*
  Some utilities, static data, etc.
*/

function splitFilename(fullName) {
  var idx = fullName.lastIndexOf('.');
  if (idx==-1) {
    return {
      name: fullName,
      extension: ""
    };
  }
  else {
    return {
      name: fullName.substr(0, idx),
      extension: fullName.substr(idx+1).toLowerCase()
    };
  }
}


// swapping
function swap(arr, i, j) {
  var tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}


// Vector3 stuff

// for turning "x" etc. into a normalized Vector3 along axis
var axisToVector3 = function(axis){
  var v = new THREE.Vector3();
  v[axis] = 1;
  return v;
}

// turn 0/1/2 component into 'x'/'y'/'z' label
var vector3ComponentToAxis = function(component) {
  if (component==0) return 'x';
  else if (component==1) return 'y';
  else return 'z';
}

// cycle axis label to the next axis
function cycleAxis(axis) {
  if (axis=='x') return 'y';
  else if (axis=='y') return 'z';
  else return 'x';
}

// special vectors
function getZeroVector() { return new THREE.Vector3(0,0,0); }
function getOneVector() { return new THREE.Vector3(1,1,1); }

// element max/min
function vector3Max(v) {
  return Math.max(v.x, v.y, v.z);
}
function vector3Min(v) {
  return Math.min(v.x, v.y, v.z);
}
// return 'x', 'y', or 'z' depending on which element is greater/lesser
function vector3ArgMax(v) {
  return v.x>v.y ? (v.x>v.z ? 'x' : 'z') : (v.y>v.z ? 'y' : 'z');
}
function vector3ArgMin(v) {
  return v.x<v.y ? (v.x<v.z ? 'x' : 'z') : (v.y<v.z ? 'y' : 'z');
}
function clamp(x, minVal, maxVal) {
  if (x<minVal) x = minVal;
  else if (x>maxVal) x = maxVal;
  return x;
}
function vector3Abs(v) {
  var result = new THREE.Vector3();
  result.x = Math.abs(v.x);
  result.y = Math.abs(v.y);
  result.z = Math.abs(v.z);
  return result;
}


// bool checks

function isArray(item) {
  return (Object.prototype.toString.call(item) === '[object Array]');
}

function isString(item) {
  return (typeof item === 'string' || item instanceof String);
}

function isNumber(item) {
  return (typeof item === 'number');
}

function isFunction(item) {
  return (typeof item === 'function');
}

function isInfinite(n) {
  return n==Infinity || n==-Infinity;
}

// check if object has properties
function objectIsEmpty(obj) {
  var isEmpty = true;
  for (var key in obj) {
    isEmpty = false;
    break;
  }
  return isEmpty;
}

// THREE.Face3- and THREE.Vector3-related functions
// get THREE.Face3 vertices
function faceGetVerts(face, vertices) {
  return [
    vertices[face.a],
    vertices[face.b],
    vertices[face.c]
  ];
}
// get THREE.Face3 vertices and sort them in ascending order on axis
function faceGetVertsSorted(face, vertices, axis) {
  var verts = faceGetVerts(face, vertices);
  var ccw = true;
  var a = verts[0][axis];
  var b = verts[1][axis];
  var c = verts[2][axis];

  if (c > a) {
    if (b > c) {
      swap (verts, 1, 2);
      ccw = false;
    }
    else if (a > b) {
      swap (verts, 0, 1);
      ccw = false;
    }
  }
  else {
    if (b > a) {
      swap (verts, 0, 2);
      swap (verts, 1, 2);
    }
    else if (c > b) {
      swap (verts, 0, 2);
      swap (verts, 0, 1);
    }
    else {
      swap (verts, 0, 2);
      ccw = false;
    }
  }

  return {
    verts: verts,
    ccw: ccw
  };
}
// compute THREE.Face3 normal
function faceComputeNormal(face, vertices) {
  var verts = faceGetVerts(face, vertices);
  face.normal.copy(vertsComputeNormal(...verts));
}
function vertsComputeNormal(a, b, c) {
  var ba = a.clone().sub(b);
  var bc = c.clone().sub(b);

  return bc.cross(ba).normalize();
}
function faceGetBounds(face, axis, vertices) {
  var verts = faceGetVerts(face, vertices);
  return {
    max: Math.max(verts[0][axis], Math.max(verts[1][axis], verts[2][axis])),
    min: Math.min(verts[0][axis], Math.min(verts[1][axis], verts[2][axis]))
  };
}
// Get THREE.Face3 subscript ('a', 'b', or 'c') for a given 0-2 index.
function faceGetSubscript(idx) {
  return (idx==0) ? 'a' : ((idx==1) ? 'b' : 'c');
}
function vertexHash(v, p) {
  return Math.round(v.x*p)+'_'+Math.round(v.y*p)+'_'+Math.round(v.z*p);
}

// Remove all meshes with a particular name from a scene.
function removeMeshByName(scene, name) {
  if (!scene) return;

  for (var i=scene.children.length-1; i>=0; i--) {
    var child = scene.children[i];
    if (child.name == name) {
      scene.remove(child);
    }
  }
}

// u cross v = (uy vz - uz vy, uz vx - ux vz, ux vy - uy vx)
// u = b - a; v = c - a; u cross v = 2 * area
// (b-a) cross (c-a) = 2 * area = (
//  (by-ay)(cz-az) - (bz-az)(cy-ay),
//  (bz-az)(cx-ax) - (bx-ax)(cz-az),
//  (bx-ax)(cy-ay) - (by-ay)(cx-ax),
// )
function triangleArea(a, b, c, axis) {
  var area = 0;
  if (axis == "x") area = (b.y-a.y)*(c.z-a.z) - (b.z-a.z)*(c.y-a.y);
  if (axis == "y") area = (b.z-a.z)*(c.x-a.x) - (b.x-a.x)*(c.z-a.z);
  if (axis == "z") area = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
  return area/2;
}

// for vertex hash maps

// gets the index of a vertex in a hash map, adding it to the map and vertex
// array if necessary
// inputs:
//  map: hash map ({hash:idx} object)
//  v: vertex whose index to get, adding it to the map and array as necessary
//  vertices: array of vertices whose indices are stored in the hash map
//  p: precision factor
function vertexMapIdx(map, v, vertices, p) {
  var hash = vertexHash(v, p);
  var idx = -1;
  if (map[hash]===undefined) {
    idx = vertices.length;
    map[hash] = idx;
    vertices.push(v);
  }
  else {
    idx = map[hash];
  }
  return idx;
}

// make a hash map of a whole array of vertices at once
function vertexArrayToMap(map, vertices, p) {
  for (var v=0; v<vertices.length; v++) {
    map[vertexHash(vertices[v], p)] = v;
  }
}

// intersection between line segment and plane normal to axis
function segmentPlaneIntersection(axis, plane, va, vb) {
  // va assumed lower on axis than vb; if not, make it so
  if (va[axis] > vb[axis]) {
    var tmp = va;
    va = vb;
    vb = tmp;
  }

  // if equal, just return va
  if (va[axis] == vb[axis]) return va;

  // calculate linear interpolation factor; note that, as checked above, the
  // denominator will be positive
  var t = (plane - va[axis]) / (vb[axis] - va[axis]);
  // interpolate
  return va.clone().multiplyScalar(1-t).add(vb.clone().multiplyScalar(t));
}


// non-blocking iterator
// params:
//  f: function to repeat
//  n: number of times to repeat the function
//  batchSize (optional): repeat the function this many times at each iteration
//  onDone (optional): call this when done iterating
//  onProgress (optional): call this at every iteration step
//  onStop (optional): call this when the stop() function is called
// usage:
//  make a new instance with at least the first two params, call start()
function functionIterator(f, n, batchSize, onDone, onProgress, onStop) {
  this.f = f;
  this.n = n;
  this.i = 0;
  this.batchSize = (batchSize===undefined || batchSize<1) ? 1 : batchSize;
  this.onStop = onStop;
  this.onProgress = onProgress;
  this.onDone = onDone;
  this.timer = 0;

  // begin iterating and repeat until done
  this.start = function() {
    this.i = 0;

    this.timer = setTimeout(this.iterate.bind(this), 16);
  };

  // main unit of iteration: repeatedly run f, stopping after batchSize
  // repetitions (or fewer, if we've hit n)
  this.iterate = function() {
    var i;
    var limit = this.i+this.batchSize;
    var n = this.n;
    for (i=this.i; i<limit && i<n; i++) {
      this.f(i);
    }

    this.i = i;

    if (this.onProgress) this.onProgress(i);

    if (i>=n) {
      clearTimeout(this.timer);
      if (this.onDone) this.onDone();
      return;
    }

    this.timer = setTimeout(this.iterate.bind(this), 0);
  };

  // manually terminate the iteration
  this.stop = function() {
    clearTimeout(this.timer);

    if (this.onStop) this.onStop(this.i);
  };

  // return true if there are more iterations to run
  this.running = function() {
    return this.i<this.n;
  }
}


// chart of ring inner diameters in mm
// (source: https://en.wikipedia.org/wiki/Ring_size)
var ringSizes = {
  "    0": 11.63,
  " 0.25": 11.84,
  "  0.5": 12.04,
  " 0.75": 12.24,
  "    1": 12.45,
  " 1.25": 12.65,
  "  1.5": 12.85,
  " 1.75": 13.06,
  "    2": 13.26,
  " 2.25": 13.46,
  "  2.5": 13.67,
  " 2.75": 13.87,
  "    3": 14.07,
  " 3.25": 14.27,
  "  3.5": 14.48,
  " 3.75": 14.68,
  "    4": 14.88,
  " 4.25": 15.09,
  "  4.5": 15.29,
  " 4.75": 15.49,
  "    5": 15.7,
  " 5.25": 15.9,
  "  5.5": 16.1,
  " 5.75": 16.31,
  "    6": 16.51,
  " 6.25": 16.71,
  "  6.5": 16.92,
  " 6.75": 17.12,
  "    7": 17.32,
  " 7.25": 17.53,
  "  7.5": 17.73,
  " 7.75": 17.93,
  "    8": 18.14,
  " 8.25": 18.34,
  "  8.5": 18.54,
  " 8.75": 18.75,
  "    9": 18.95,
  " 9.25": 19.15,
  "  9.5": 19.35,
  " 9.75": 19.56,
  "   10": 19.76,
  "10.25": 19.96,
  " 10.5": 20.17,
  "10.75": 20.37,
  "   11": 20.57,
  "11.25": 20.78,
  " 11.5": 20.98,
  "11.75": 21.18,
  "   12": 21.39,
  "12.25": 21.59,
  " 12.5": 21.79,
  "12.75": 22,
  "   13": 22.2,
  "13.25": 22.4,
  " 13.5": 22.61,
  "13.75": 22.81,
  "   14": 23.01,
  "14.25": 23.22,
  " 14.5": 23.42,
  "14.75": 23.62,
  "   15": 23.83,
  "15.25": 24.03,
  " 15.5": 24.23,
  "15.75": 24.43,
  "   16": 24.64
}


// memory usage - from zensh on github: https://gist.github.com/zensh/4975495
function memorySizeOf(obj) {
  var bytes = 0;

  function sizeOf(obj) {
    if(obj !== null && obj !== undefined) {
      switch(typeof obj) {
      case 'number':
        bytes += 8;
        break;
      case 'string':
        bytes += obj.length * 2;
        break;
      case 'boolean':
        bytes += 4;
        break;
      case 'object':
        var objClass = Object.prototype.toString.call(obj).slice(8, -1);
        if(objClass === 'Object' || objClass === 'Array') {
          for(var key in obj) {
            if(!obj.hasOwnProperty(key)) continue;
            sizeOf(obj[key]);
          }
        } else bytes += obj.toString().length * 2;
        break;
      }
    }
    return bytes;
  };

  function formatByteSize(bytes) {
    if(bytes < 1024) return bytes + " bytes";
    else if(bytes < 1048576) return(bytes / 1024).toFixed(3) + " KiB";
    else if(bytes < 1073741824) return(bytes / 1048576).toFixed(3) + " MiB";
    else return(bytes / 1073741824).toFixed(3) + " GiB";
  };

  return formatByteSize(sizeOf(obj));
};
