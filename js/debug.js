function Debug(scene) {
  this.scene = scene;
  this.debugPointGeo = new THREE.Geometry();
  this.debugLineGeo = new THREE.Geometry();
}
Debug.prototype.debugLoop = function(loop, fn) {
  if (fn === undefined) fn = function() { return true; };
  var curr = loop.vertex;
  do {
    if (fn(curr)) debugVertex(curr.v);
    curr = curr.next;
  } while (curr != loop.vertex);
}
Debug.prototype.debugLine = function(v, w, n, lastonly, offset) {
  if (n === undefined) n = 1;
  if (offset === undefined) offset = 0;

  for (var i=0; i<=n; i++) {
    if (lastonly && (n==0 || i<n-1)) continue;
    var vert = w.clone().multiplyScalar(i/n).add(v.clone().multiplyScalar((n-i)/n));
    vert.z += 0.1*offset;
    //this.debugPointGeo.vertices.push(vert);
  }
  var vv = v.clone();
  vv.z += 0.1*offset;
  var ww = w.clone();
  ww.z += 0.1*offset;
  this.debugLineGeo.vertices.push(vv);
  this.debugLineGeo.vertices.push(ww);
  this.debugPointGeo.verticesNeedUpdate = true;
}
Debug.prototype.debugPoint = function(v) {
  this.debugPointGeo.vertices.push(v);
  this.debugPointGeo.verticesNeedUpdate = true;
}
Debug.prototype.debugFace = function(f, vs) {
  var verts = faceGetVerts(f, vs);
  this.debugPoint(verts[0].clone().add(verts[1]).add(verts[2]).divideScalar(3));
  //this.debugPoints();
}
Debug.prototype.debugPoints = function(idx, incr) {
  var color = 0xff6666;
  if (incr===undefined) incr = 0;
  if (idx!==undefined) {
    color = parseInt(('0.'+Math.sin(idx+incr).toString().substr(6))*0xffffff);
  }
  else idx = 0;
  var debugMaterial = new THREE.PointsMaterial( { color: color, size: 3, sizeAttenuation: false });
  var debugMesh = new THREE.Points(this.debugPointGeo, debugMaterial);
  debugMesh.name = "debug";
  this.scene.add(debugMesh);

  this.debugPointGeo = new THREE.Geometry();
}
Debug.prototype.debugLines = function(idx, incr) {
  var color = 0xff6666;
  if (incr===undefined) incr = 0;
  if (idx!==undefined) {
    color = parseInt(('0.'+Math.sin(idx+incr).toString().substr(6))*0xffffff);
    //console.log("%c idx "+idx, 'color: #'+color.toString(16));
  }
  else idx = 0;
  var debugLineMaterial = new THREE.LineBasicMaterial({color: color, linewidth: 1 });
  var debugLineMesh = new THREE.LineSegments(this.debugLineGeo, debugLineMaterial);
  debugLineMesh.name = "debugLine";
  this.scene.add(debugLineMesh);

  this.debugLineGeo = new THREE.Geometry();
}
Debug.prototype.debugCleanup = function() {
  removeMeshByName(this.scene, "debug");
  removeMeshByName(this.scene, "debugLine");
}
