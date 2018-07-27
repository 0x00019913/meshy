var Units = (function() {

  var mm = "mm";
  var cm = "cm";
  var inches = "inches";

  function id(val) { return val; }
  function mmtocm(val) { return val * 0.1; }
  function mmtoin(val) { return val * 0.0393701; }
  function cmtomm(val) { return val * 10; }
  function cmtoin(val) { return val * 0.393701; }
  function intomm(val) { return val * 25.4; }
  function intocm(val) { return val * 2.54; }
  function mmtocmV3(val) { return val.clone().multiplyScalar(0.1); }
  function mmtoinV3(val) { return val.clone().multiplyScalar(0.0393701); }
  function cmtommV3(val) { return val.clone().multiplyScalar(10); }
  function cmtoinV3(val) { return val.clone().multiplyScalar(0.393701); }
  function intommV3(val) { return val.clone().multiplyScalar(25.4); }
  function intocmV3(val) { return val.clone().multiplyScalar(2.54); }

  function getConverter(from, to) {
    if (from === to) return id;
    else if (from === mm) {
      if (to === cm) return mmtocm;
      if (to === inches) return mmtoin;
    }
    else if (from === cm) {
      if (to === mm) return cmtomm;
      if (to === inches) return cmtoin;
    }
    else if (from === inches) {
      if (to === mm) return intomm;
      if (to === cm) return intocm;
    }

    return id;
  }

  function getConverterV3(from, to) {
    if (from === to) return id;
    else if (from === mm) {
      if (to === cm) return mmtocmV3;
      if (to === inches) return mmtoinV3;
    }
    else if (from === cm) {
      if (to === mm) return cmtommV3;
      if (to === inches) return cmtoinV3;
    }
    else if (from === inches) {
      if (to === mm) return intommV3;
      if (to === cm) return intocmV3;
    }

    return id;
  }



  return {
    mm: mm,
    cm: cm,
    inches: inches,
    getConverter: getConverter,
    getConverterV3: getConverterV3
  };

})();
