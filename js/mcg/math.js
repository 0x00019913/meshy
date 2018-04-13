MCG.Math = (function() {

  function coincident(a, b) {
    return a.h === b.h && a.v === b.v;
  }

  function area(a, b, c) {
    var ash = a.sh, asv = a.sv;
    var bsh = b.sh, bsv = b.sv;
    var csh = c.sh, csv = c.sv;

    var cross = (bsh-ash) * (csv-asv) - (bsv-asv) * (csh-ash);
    return cross / 2;
  }

  function intArea(a, b, c) {
    var cross = (b.h-a.h) * (c.v-a.v) - (b.v-a.v) * (c.h-a.h);
    return cross / 2;
  }

  function collinear(a, b, c) {
    return area(a, b, c) === 0;
  }

  return {
    coincident: coincident,
    collinear: collinear,
    area: area,
    intArea: intArea
  }

})();
