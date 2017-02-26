/*
  Some utilities.
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
axisToVector3Map = {
  x: new THREE.Vector3(1,0,0),
  y: new THREE.Vector3(0,1,0),
  z: new THREE.Vector3(0,0,1),
}

isArray = function(item) {
  return (Object.prototype.toString.call(item) === '[object Array]');
}

isString = function(item) {
  return (typeof item === 'string' || item instanceof String);
}

isNumber = function(item) {
  return (typeof item === 'number');
}
isFunction = function(item) {
  return (typeof item === 'function');
}
