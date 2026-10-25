$(document).ready(function(){const PLAYER_LOOKUP_RETRIES=20;const PLAYER_LOOKUP_DELAY_MS=250;const DESKTOP_MIN_WIDTH=992;$('[data-hero-vod-carousel]').each(function(){initHeroCarousel($(this));});const $buttons=$('.hero-vod-favourite');if($buttons.length&&window.AppConfig?.enableUserTracking){authService.getAuthPromise().then(function(authStatus){initFavouriteButtons(authStatus.success&&authStatus.profileLoaded);});}
async function initFavouriteButtons(isLoggedIn){const savedIds={};if(isLoggedIn){const ids=[...new Set($buttons.map(function(){return $(this).data('series-id');}).get())];await Promise.all(ids.map(async function(id){savedIds[id]=await ProfileBookmarkService.isItemInFavourites(id);}));}
$buttons.each(function(){syncFavouriteButton($(this),savedIds[$(this).data('series-id')]);$(this).closest('.hero-vod-favourite-wrapper').addClass('is-ready');});$(document).on('click touchend','.hero-vod-favourite',function(event){event.stopPropagation();if(!isLoggedIn){window.location.href=$(this).data('login-page-url');return;}
handleFavouriteClick($(this));});}
function syncFavouriteButton($button,isSaved){const $wrapper=$button.closest('.hero-vod-favourite-wrapper');const $srText=$button.find('.visually-hidden');const text=isSaved?$wrapper.data('is-saved-text'):$wrapper.data('save-text');$button.toggleClass('is-saved',!!isSaved);$button.attr('aria-pressed',isSaved?'true':'false');$button.attr('title',isSaved?$button.data('remove-save-tooltip'):$button.data('save-tooltip'));$srText.text(text);}
function handleFavouriteClick($button){if($button.prop('disabled')){return;}
const seriesId=$button.data('series-id');const isSaved=$button.hasClass('is-saved');const $all=$(`.hero-vod-favourite[data-series-id="${seriesId}"]`);const $loaders=$all.closest('.hero-vod-favourite-wrapper').find('.spinner-loader');$all.prop('disabled',true).addClass('d-none');$loaders.removeClass('d-none');const request=isSaved?ProfileBookmarkService.removeFavourite(seriesId):ProfileBookmarkService.addFavourite(seriesId);request.done(function(){$all.each(function(){syncFavouriteButton($(this),!isSaved);});if(typeof trackFavouritesEvent==='function'){trackFavouritesEvent(!isSaved);}}).always(function(){$loaders.addClass('d-none');$all.removeClass('d-none').prop('disabled',false);});}
function initHeroCarousel($slider){if($slider.hasClass('slick-initialized')){return;}
const $section=$slider.closest('.hero-vod-section');const isStatic=$slider.is('[data-hero-vod-static]');if(isStatic&&window.innerWidth<DESKTOP_MIN_WIDTH){$slider.find('.hero-vod-video').remove();}
const durationSec=parseInt($slider.data('slide-duration'),10)||0;const useTimer=!isStatic&&durationSec>0;const state={muted:true,inViewport:true};let slideTimer=null;if(isStatic){activateSlide(activeSlide());}
else{$slider.on('init',function(event,slick){activateSlide($(slick.$slides[slick.currentSlide]));});$slider.on('beforeChange',function(event,slick,currentSlide,nextSlide){deactivateSlide($(slick.$slides[currentSlide]));activateSlide($(slick.$slides[nextSlide]));});$slider.slick({rtl:true,dots:true,arrows:false,infinite:true,slidesToShow:1,slidesToScroll:1,swipe:true,touchThreshold:500});}
window.RedgePlayer?.initNewPlayers();$slider.on('click','[data-hero-vod-next]',function(event){event.stopPropagation();advanceSlide();});$section.on('click','[data-hero-vod-mute]',function(event){event.stopPropagation();state.muted=!state.muted;syncMuteButton();withCurrentPlayer(applySound);});watchViewport();function activateSlide($slide){scheduleTimer();withPlayer(getSlidePlayerId($slide),function(player){bindEnded(player);applySound(player);if(state.inViewport){player.play();}});}
function deactivateSlide($slide){withPlayer(getSlidePlayerId($slide),function(player){player.setVolume(0);player.pause();});}
function applySound(player){if(state.muted){player.setVolume(0);}
else if(typeof player.unMute==='function'){player.unMute();}}
function bindEnded(player){if(isStatic||player._heroEndedBound){return;}
player._heroEndedBound=true;player.on('ended',function(){advanceSlide();});}
function scheduleTimer(){if(!useTimer){return;}
clearTimeout(slideTimer);slideTimer=setTimeout(advanceSlide,durationSec*1000);}
function stopTimer(){clearTimeout(slideTimer);}
function advanceSlide(){$slider.slick('slickNext');}
function syncMuteButton(){$section.find('[data-hero-vod-mute]').toggleClass('unmute',!state.muted).attr('aria-pressed',state.muted?'false':'true');}
function withCurrentPlayer(callback){withPlayer(getSlidePlayerId(activeSlide()),callback);}
function activeSlide(){return isStatic?$slider.find('[data-hero-vod-slide]').first():$slider.find('.slick-current');}
function getSlidePlayerId($slide){const el=$slide.find('.redge-player')[0];return el?$(el).data('player-id'):null;}
function withPlayer(playerId,callback,attempt){if(!playerId||!window.RedgePlayer){return;}
const player=window.RedgePlayer.getPlayer(playerId);if(player){callback(player);return;}
const nextAttempt=(attempt||0)+1;if(nextAttempt>PLAYER_LOOKUP_RETRIES){return;}
setTimeout(function(){withPlayer(playerId,callback,nextAttempt);},PLAYER_LOOKUP_DELAY_MS);}
function watchViewport(){if(!('IntersectionObserver' in window)||!$section.length){return;}
const observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){state.inViewport=entry.isIntersecting;if(entry.isIntersecting){scheduleTimer();withCurrentPlayer(function(player){applySound(player);player.play();});return;}
state.muted=true;syncMuteButton();stopTimer();withCurrentPlayer(function(player){player.setVolume(0);player.pause();});});},{threshold:0.5});observer.observe($section[0]);}}});;;
