var Calculate = (function() {

  var Vector3 = THREE.Vector3;
  var Line3 = THREE.Line3;
  var Box3 = THREE.Box3;
  var Plane = THREE.Plane;

  // get an array of the face's vertices in the original winding order
  function _faceVertices(face, vertices, matrix) {
    var va = new Vector3().copy(vertices[face.a]);
    var vb = new Vector3().copy(vertices[face.b]);
    var vc = new Vector3().copy(vertices[face.c]);

    if (matrix !== undefined) {
      va.applyMatrix4(matrix);
      vb.applyMatrix4(matrix);
      vc.applyMatrix4(matrix);
    }

    return [va, vb, vc];
  }

  // calculate face area
  function _faceArea(face, vertices, matrix) {
    var [a, b, c] = _faceVertices(face, vertices, matrix);

    // (b - a) cross (c - a) / 2
    return b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }

  // calculate the volume of an irregular tetrahedron with one vertex at the
  // origin and the given face forming the remaining three vertices
  function _faceVolume(face, vertices, matrix) {
    var [a, b, c] = _faceVertices(face, vertices, matrix);

    var volume = 0;
    volume += (-c.x*b.y*a.z + b.x*c.y*a.z + c.x*a.y*b.z);
    volume += (-a.x*c.y*b.z - b.x*a.y*c.z + a.x*b.y*c.z);

    return volume / 6;
  }

  function _faceCenter(face, vertices, matrix) {
    var [a, b, c] = _faceVertices(face, vertices, matrix);

    return a.clone().add(b).add(c).divideScalar(3);
  }

  // center of mass of an irregular tetrahedron with one vertex at the origin
  // and the given face forming the remaining three vertices
  function _faceCenterOfMass(face, vertices, matrix) {
    var [a, b, c] = _faceVertices(face, vertices, matrix);

    return a.add(b).add(c).divideScalar(4);
  }

  function _faceBoundingBox(face, vertices, matrix) {
    var [a, b, c] = _faceVertices(face, vertices, matrix);
    var boundingBox = new THREE.Box3();

    boundingBox.expandByPoint(a);
    boundingBox.expandByPoint(b);
    boundingBox.expandByPoint(c);

    return boundingBox;
  }

  // calculate the intersection of a face with an arbitrary plane
  function _planeFaceIntersection(plane, face, vertices, matrix) {
    var [a, b, c] = _faceVertices(face, vertices, matrix);

    // intersection points of the plane with all three face segments; each is
    // undefined if no intersection
    var vab = plane.intersectLine(new Line3(a, b));
    var vbc = plane.intersectLine(new Line3(b, c));
    var vca = plane.intersectLine(new Line3(c, a));

    // if no intersections, return null
    if (vab === undefined && vbc === undefined && vca === undefined) {
      return null;
    }
    // in the anomalous situation that the plane intersects all three segments,
    // do special handling
    else if (vab !== undefined && vbc !== undefined && vca !== undefined) {
      // two possible degenerate cases:
      // 1. all three points lie on the plane, so there's no segment intersection
      // 2. two points lie on the plane - they form the segment
      var da = plane.distanceToPoint(a);
      var db = plane.distanceToPoint(b);
      var dc = plane.distanceToPoint(c);

      // if 1, return null
      if (da === 0 && db === 0 && dc === 0) return null;

      // if 2, two of the intersection points will be coincident; return two
      // non-coincident points (but only if one of them is above the plane)
      if (vab.equals(vbc) && (da > 0 || dc > 0)) return new Line3(vab, vca);
      else if (vbc.equals(vca) && (db > 0 || da > 0)) return new Line3(vbc, vab);
      else if (vca.equals(vab) && (dc > 0 || db > 0)) return new Line3(vca, vbc);
      else return null;
    }

    // get the first and second intersections
    var v0 = vab !== undefined ? vab : vbc !== undefined ? vbc : vca;
    var v1 = v0 === vab ? (vbc !== undefined ? vbc : vca) : (v0 === vbc ? vca : undefined);

    // if either intersection doesn't exist, return null
    if (v0 === undefined || v1 === undefined) return null;
    // if intersection points are the same, return null
    if (v0.equals(v1)) return null;

    return new Line3(v0, v1);
  }

  // apply a function to each face
  function _traverseFaces(mesh, callback) {
    var geo = mesh.geometry;
    var faces = geo.faces, vertices = geo.vertices;
    var matrix = mesh.matrixWorld;

    for (var f = 0; f < faces.length; f++) {
      callback(faces[f], vertices, matrix);
    }
  }

  // calculate the surface area of a mesh
  function _surfaceArea(mesh) {
    var area = 0;

    _traverseFaces(mesh, function(face, vertices, matrix) {
      area += _faceArea(face, vertices, matrix);
    });

    return area;
  }

  // calculate the volume of a mesh
  function _volume(mesh) {
    var volume = 0;

    _traverseFaces(mesh, function(face, vertices, matrix) {
      volume += _faceVolume(face, vertices, matrix);
    });

    return volume;
  }

  // calculate the center of mass of a mesh
  function _centerOfMass(mesh) {
    var center = new Vector3();
    var volume = 0;

    _traverseFaces(mesh, function(face, vertices, matrix) {
      var faceVolume = _faceVolume(face, vertices, matrix);
      var faceCenterOfMass = _faceCenterOfMass(face, vertices, matrix);

      // add current face's center of mass, weighted by its volume
      center.add(faceCenterOfMass.multiplyScalar(faceVolume));

      // update volume
      volume += faceVolume;
    });

    // divide by total volume to get center of mass
    return center.divideScalar(volume);
  }

  function _crossSection(plane, mesh) {
    var point = new Vector3();
    plane.coplanarPoint(point);

    var normal = new Vector3();
    var pa = new Vector3();
    var pb = new Vector3();

    // total cross-section area
    var crossSectionArea = 0;
    // axis-aligned bounding box
    var boundingBox = new THREE.Box3();
    // segments forming the intersection
    var segments = [];
    // length of the intersection contour
    var length = 0;

    _traverseFaces(mesh, function(face, vertices, matrix) {
      var segment = _planeFaceIntersection(plane, face, vertices, matrix);

      // nonzero contribution if plane intersects face
      if (segment !== null) {
        boundingBox.expandByPoint(segment.start);
        boundingBox.expandByPoint(segment.end);

        // triangle between coplanar point and the two endpoints of the segment
        pa.subVectors(segment.start, point);
        pb.subVectors(segment.end, point);

        // normal in world space
        normal.copy(face.normal).transformDirection(matrix);

        // compute area of the triangle; possibly force it negative depending on
        // the normal
        var area = pa.clone().cross(pb).length() / 2;
        var sign = Math.sign(pa.dot(normal));

        crossSectionArea += area * sign;

        // store segment in segments array and increment contour length
        segments.push(segment);

        length += segment.start.distanceTo(segment.end);
      }
    });

    // return the value of the cross-section and its bounds along the axes
    return {
      area: crossSectionArea,
      boundingBox: boundingBox,
      segments: segments,
      length: length
    };
  }

  // calculate circle normal, center, and radius from three coplanar points:
  // take two pairs of coplanar points, calculate bisector of both pairs;
  // the bisectors will intersect at the center
  function _circleFromThreePoints(p0, p1, p2) {
    var sa = p0.clone().sub(p1);
    var sb = p2.clone().sub(p1);

    // normal
    var normal = sa.clone().cross(sb).normalize();

    // if points are collinear, can't compute the circle, so unready the
    // result and return
    if (normal.length() === 0) return null;

    // bisector points
    var pa = p0.clone().add(p1).multiplyScalar(0.5);
    var pb = p2.clone().add(p1).multiplyScalar(0.5);

    // bisector directions
    var da = normal.clone().cross(sa).normalize();
    var db = normal.clone().cross(sb).normalize();

    // the bisectors won't generally intersect exactly, but we can
    // calculate a point of closest approach:
    // if line 0 and 1 are
    // v0 = p0 + t0d0, v1 = p1 + t1d1, then
    // t0 = ((d0 - d1 (d0 dot d1)) dot (p1 - p0)) / (1 - (d0 dot d1)^2)
    // t1 = ((d0 (d0 dot d1) - d1) dot (p1 - p0)) / (1 - (d0 dot d1)^2)

    var dadb = da.dot(db);
    var denominator = 1 - dadb * dadb;

    // just in case, to avoid division by 0
    if (denominator === 0) return null;

    // scalar parameter
    var ta = da.clone().addScaledVector(db, -dadb).dot(pb.clone().sub(pa)) / denominator;

    var center = pa.clone().addScaledVector(da, ta);
    var radius = center.distanceTo(p2);

    return {
      normal: normal,
      center: center,
      radius: radius
    };
  }

  function _numHash(n, p) {
    return Math.round(n*p);
  }

  function _vectorHash(v, p) {
    return _numHash(v.x, p)+'_' + _numHash(v.y, p) + '_' + _numHash(v.z, p);
  }

  // todo: finish
  function _polygonsFromSegments(segments, p) {
    p = p !== undefined ? p : 5;

    // adjacency map
    var m = {};

    for (var s = 0, l = segments.length; s < l; s++) {
      var segment = segments[s];


    }
  }

  return {
    faceVertices: _faceVertices,
    faceArea: _faceArea,
    faceCenter: _faceCenter,
    faceBoundingBox: _faceBoundingBox,
    surfaceArea: _surfaceArea,
    volume: _volume,
    centerOfMass: _centerOfMass,
    crossSection: _crossSection,
    circleFromThreePoints: _circleFromThreePoints
  };

})();
