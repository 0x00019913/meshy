MCG.Boolean = (function() {

  var Boolean = {
    union: union
  };

  function union(a, b) {
    return MCG.Sweep.sweep(a, b);
  }


  return Boolean;

})();
