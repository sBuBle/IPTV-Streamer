$(document).ready(function(){$('.mobile-share-button').off('click',initNavigatorShare).on('click',initNavigatorShare);})
function initNavigatorShare(e){e.preventDefault();e.stopPropagation();let title=this.getAttribute('share-title')
let shareUrl=this.getAttribute('share-url')
let currentUrl=window.location.href;if(shareUrl){currentUrl=shareUrl;}
currentUrl=removeURLParameter(currentUrl,'app');if(navigator.share){let shareData={title:title,url:currentUrl}
navigator.share(shareData).then(function(){console.log('Thanks for sharing!');}).catch(function(err){console.log("Error while using Web share API:");console.log(err);});}else{alert("Browser doesn't support this API!");}};;
