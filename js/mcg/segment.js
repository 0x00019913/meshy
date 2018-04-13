MCG.Segment = (function() {

  function Segment(p1, p2, attributes) {
    this.p1 = p1;
    this.p2 = p2;

    this.type = MCG.GeometryTypes.segment;
  }

  return Segment;

})();
