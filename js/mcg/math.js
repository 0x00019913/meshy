Object.assign(MCG.Math, (function() {

  function coincident(a, b) {
    return a.h === b.h && a.v === b.v;
  }

  // area of a-b-c triangle in integer space
  function area(a, b, c) {
    var cross = (c.h-b.h) * (a.v-b.v) - (c.v-b.v) * (a.h-b.h);
    return cross / 2;
  }

  // area of a-b-c triangle in floating-point space
  function farea(a, b, c) {
    var ash = a.sh(), asv = a.sv();
    var bsh = b.sh(), bsv = b.sv();
    var csh = c.sh(), csv = c.sv();

    var cross = (bsh-ash) * (csv-asv) - (bsv-asv) * (csh-ash);
    return cross / 2;
  }

  // area of a-b-c triangle using normalized a-b and a-c edges
  function narea(a, b, c) {
    var bc = b.vectorTo(c).normalize();
    var ba = b.vectorTo(a).normalize();

    return bc.cross(ba) / 2;
  }

  // leftness predicates - these account for the fuzziness introduced by
  // vertices' snapping to the integer grid

  // returns 0 if c collinear with a-b, 1 if c left of a-b, else -1
  function leftCompare(a, b, c) {
    var abdistsq = a.distanceToSq(b);
    var bcdistsq = b.distanceToSq(c);
    var cadistsq = c.distanceToSq(a);
    var maxdist = Math.sqrt(Math.max(abdistsq, bcdistsq, cadistsq));

    var tarea = area(a, b, c);

    // Given triangle a-b-c, take the longest side - let's say it's a-b.
    // If a, b, and c are collinear, c's deviation from a-b should be at most
    // sqrt(2), and the area of a-b-c should be at most (a-b dist) * sqrt2 / 2
    // (deviation results from the fact that the coordinates snap to an integer
    // grid, so the integer coords may not be collinear even if their original
    // float coords were within a reasonable epsilon).

    if (Math.abs(tarea) < maxdist * Math.SQRT2) return 0;
    else return Math.sign(tarea);
  }

  function collinear(a, b, c) {
    return leftCompare(a, b, c) === 0;
  }

  function left(a, b, c) {
    return leftCompare(a, b, c) > 0;
  }

  function leftOn(a, b, c) {
    return leftCompare(a, b, c) >= 0;
  }

  // strict predicates - exact comparisons of area

  function leftCompareStrict(a, b, c) {
    return Math.sign(area(a, b, c));
  }

  function collinearStrict(a, b, c) {
    return leftCompareStrict(a, b, c) === 0;
  }

  function leftStrict(a, b, c) {
    return leftCompareStrict(a, b, c) > 0;
  }

  function leftOnStrict(a, b, c) {
    return leftCompareStrict(a, b, c) >= 0;
  }

  // signifies special types of intersection between a0-a1 and b0-b1 segments
  var IntersectionFlags = {
    none: 0,            // no intersection
    intermediate: 1,    // intersection excludes endpoints
    a0: 2,              // intersection point is a0
    a1: 4,              // intersectoin point is a1
    b0: 8,              // intersection point is b0
    b1: 16              // intersection point is b1
  };

  // intersection predicate: return true if a-b segment intersects c-d
  // segment; returns
  function intersect(a, b, c, d) {
    // leftness checks for the endpoint of one segment against the other segment
    var labc = leftCompare(a, b, c), labd = leftCompare(a, b, d);
    var lcda = leftCompare(c, d, a), lcdb = leftCompare(c, d, b);

    var result = IntersectionFlags.none;

    // a-b segment is between endpoints of c-d segment
    var abBtwn = labc !== labd || labc === 0;
    // c-d segment is between endpoints of a-b segment
    var cdBtwn = lcda !== lcdb || lcda === 0;

    // check if one endpoint lies on the other segment

    // c lies on a-b and between a-b
    if (labc === 0 && cdBtwn) result |= IntersectionFlags.b0;
    if (labd === 0 && cdBtwn) result |= IntersectionFlags.b1;
    if (lcda === 0 && abBtwn) result |= IntersectionFlags.a0;
    if (lcdb === 0 && abBtwn) result |= IntersectionFlags.a1;

    // possible intersection on intermediate points
    if (result === IntersectionFlags.none) {
      if (abBtwn && cdBtwn) {
        result = IntersectionFlags.intermediate;
      }
    }

    return result;
  }

  // calculate intersection point of a0-a1 segment and b0-b1 segment
  function intersection(a0, a1, b0, b1) {
    // denominator
    var d = a0.h * (b1.v - b0.v) + a1.h * (b0.v - b1.v) +
            b1.h * (a1.v - a0.v) + b0.h * (a0.v - a1.v);
    // if denominator is 0, segments are parallel
    if (d === 0) return null;

    // numerator
    var n;
    // calculate pa
    n = a0.h * (b1.v - b0.v) + b0.h * (a0.v - b1.v) + b1.h * (b0.v - a0.v);
    var pa = n / d;
    // calculate pb
    //n = a0.h * (a1.v - b0.v) + a1.h * (b0.v - a0.v) + b0.h * (a0.v - a1.v);
    //pb = n / d;

    return a0.clone().addScaledVector(a0.vectorTo(a1), pa);
  }

  function parallel(a, ae, b, be) {
    var da = a.vectorTo(ae);
    var db = b.vectorTo(be);

    return da.h * db.v === db.h * da.v;
  }

  // create a normalized vector that is orthogonal to and right of a-b segment
  function orthogonalRightVector(a, b) {
    var d = a.vectorTo(b);
    var h = d.h, v = d.v;

    // opposite inverse slope makes an orthogonal vector
    d.h = v;
    d.v = -h;

    return d.normalize();
  }

  // the bisector of a-b and b-c segments, looking right of both segments
  function bisector(a, b, c) {
    var abr = orthogonalRightVector(a, b);
    var bcr = orthogonalRightVector(b, c);

    return abr.add(bcr).normalize();
  }

  return {
    coincident: coincident,
    area: area,
    farea: farea,
    narea: narea,
    leftCompare: leftCompare,
    collinear: collinear,
    left: left,
    leftOn: leftOn,
    leftCompareStrict: leftCompareStrict,
    collinearStrict: collinearStrict,
    leftStrict: leftStrict,
    leftOnStrict: leftOnStrict,
    IntersectionFlags: IntersectionFlags,
    intersect: intersect,
    intersection: intersection,
    parallel: parallel,
    orthogonalRightVector: orthogonalRightVector,
    bisector: bisector
  };

})());
