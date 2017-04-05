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

// for turning "x" etc. into a normalized Vector3 along axis
var axisToVector3Map = {
  x: new THREE.Vector3(1,0,0),
  y: new THREE.Vector3(0,1,0),
  z: new THREE.Vector3(0,0,1),
}

// special vectors
var zeroVector = new THREE.Vector3(0,0,0);
var oneVector = new THREE.Vector3(1,1,1);

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

// THREE.Face3-related functions
function faceGetVerts(face, vertices) {
    return [
      vertices[face.a],
      vertices[face.b],
      vertices[face.c]
    ];
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
