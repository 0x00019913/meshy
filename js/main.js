var stage = new Stage();

// Make the intro menu interactive.
var introVisible = false;
var intro = document.getElementById('intro');
var titleChevron = document.getElementById('titleChevron');
document.getElementById('titlebox').onclick = function(){
  introVisible = !introVisible;
  if (introVisible) {
    intro.className = 'active';
    titleChevron.className = 'up';
  }
  else {
    intro.className = 'inactive';
    titleChevron.className = 'down';
  }
}
