function SupportGenerator(angle, resolution, layerHeight, axis, epsilon) {
  if (axis === undefined) axis = 'z';
  if (epsilon === undefined) epsilon = 0.0000001;

  this.dotProductCutoff = Math.cos(angle * Math.PI / 180);
  this.resolution = resolution;
  this.layerHeight = layerHeight;
  this.axis = axis;
  this.epsilon = epsilon;

  this.down = new THREE.Vector3();
  this.down[axis] = -1;
}

SupportGenerator.prototype.generate = function(vertices, faces, min) {
  var axis = this.axis;
  var ah = cycleAxis(axis);
  var av = cycleAxis(ah);
  var epsilon = this.epsilon;
  var minHeight = min[axis] + this.layerHeight/2;
  var resolution = this.resolution;

  var vs = vertices;
  var fs = faces;

  var nv = vs.length;
  var nf = fs.length;

  if (min===undefined) min = new THREE.Vector3().setScalar(-Infinity);

  var dotProductCutoff = this.dotProductCutoff;
  var down = this.down;

  var hds = new HDS(vertices, faces);

  // generate islands of overhang faces in the mesh
  var islands = generateOverhangIslands(hds);

  console.log(islands);

  for (var i=0; i<islands.length; i++) {
    break;
    var island = islands[i];
    for (var j=0; j<island.faces.length; j++) {
      var face3 = island.faces[j].face3;
      debug.debugPoint(faceGetCenter(face3, vs));
    }
    debug.debugPoints(i, 1);
  }

  // rasterize each island to find sampling points over every island
  var pointSets = samplePoints(islands);

  console.log(pointSets);

  for (var i=0; i<pointSets.length; i++) {
    var points = pointSets[i];
    for (var j=0; j<points.length; j++) {
      debug.debugPoint(points[j]);
    }
    debug.debugPoints(i, 1);
  }

  function generateOverhangIslands(hds) {
    // return true if the given HDS face is an overhang and above the base plane
    var overhang = function(face) {
      var face3 = face.face3;
      var normal = face3.normal;
      var mx = faceGetMaxAxis(face3, vs, axis);
      return down.dot(normal) > dotProductCutoff && mx > minHeight;
    }

    return hds.groupIntoIslands(overhang);
  }

  function samplePoints(islands) {
    var pointSets = [];

    // rasterization lower bounds on h and v axes
    var rhmin = min[ah];
    var rvmin = min[av];

    // for each island
    for (var i = 0; i < islands.length; i++) {
      var island = islands[i];
      var faces = island.faces;
      var points = [];

      // iterate over all faces in the island
      for (var f = 0; f < faces.length; f++) {
        var face3 = faces[f].face3;
        var normal = face3.normal;
        var [a, b, c] = faceGetVerts(face3, vs);
        // bounding box
        var bb = faceGetBounds(face3, vs);

        // this face's lower bounds in rasterization space
        var hmin = rhmin + Math.floor((bb.min[ah] - rhmin) / resolution) * resolution;
        var vmin = rvmin + Math.floor((bb.min[av] - rvmin) / resolution) * resolution;
        // this face's upper bounds in rasterization space
        var hmax = rhmin + Math.ceil((bb.max[ah] - rhmin) / resolution) * resolution;
        var vmax = rvmin + Math.ceil((bb.max[av] - rvmin) / resolution) * resolution;

        // iterate over all possible points
        for (var ph = hmin; ph < hmax; ph += resolution) {
          for (var pv = vmin; pv < vmax; pv += resolution) {
            var pt = new THREE.Vector3();
            pt[ah] = ph;
            pt[av] = pv;
            //pt[axis] = min[axis] - 0.1;

            // two triangle verts are flipped because the triangle faces down
            // and is thus wound CW when looking into the plane
            if (pointInsideTriangle(pt, b, a, c, axis, epsilon)) {
              points.push(projectToPlaneOnAxis(pt, a, normal, axis));
            }
          }
        }
      }

      // if the island is too small to hit any points in rasterization space,
      // just store the center of its first face
      if (points.length == 0) {
        var center = faceGetCenter(faces[0].face3, vs);
        points.push(center);
      }

      pointSets.push(points);
    }

    return pointSets;
  }
}

SupportGenerator.prototype.cleanup = function() {
  debug.debugCleanup();
}
