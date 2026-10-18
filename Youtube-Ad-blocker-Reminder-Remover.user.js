// ==UserScript==
// @name         Remove Adblock Thing (Playlist Fix)
// @namespace    http://tampermonkey.net/
// @version      6.0.1
// @description  Removes Adblock Thing - fixed for SPA playlist navigation (no reload-loop on 2nd video)
// @author       JoelMatic
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==


(function()
{
    //
    //      Config
    //


    // Enable The Undetected Adblocker
    const adblocker = true;


    // Enable The Popup remover
    // NOTE: must be true together with adblocker, otherwise YouTube's enforcement
    // popup appears on later playlist videos with nothing to dismiss it.
    const removePopup = true;


    // Checks for updates (Removes the popup)
    const updateCheck = false;


    // Enable debug messages into the console
    const debugMessages = true;


    // Enable custom modal
    // Uses SweetAlert2 library (https://cdn.jsdelivr.net/npm/sweetalert2@11) for the update version modal.
    // When set to false, the default window popup will be used. And the library will not be loaded.
    const updateModal = {
        enable: true, // if true, replaces default window popup with a custom modal
        timer: 5000, // timer: number | false
    };


    //
    //      CODE
    //


    //
    // Variables used for adblock
    //


    // Identity of the current video (video id + playlist id), not the raw URL.
    // YouTube rewrites t=, pp=, index=, list= on the SAME video constantly; comparing
    // the raw href made every playlist step look like a page change.
    const videoKey = () => {
        try {
            const p = new URLSearchParams(location.search);
            return (p.get('v') || '') + '|' + (p.get('list') || '');
        } catch (e) {
            return location.href;
        }
    };

    let currentKey = videoKey();

    // Used to stop reload spam
    let isReloading = false;

    // Timestamp of the last forced reload, to debounce burst navigations
    let lastReloadAt = 0;

    // Pending check timers, so bursts of events collapse into one check
    let checkTimer = 0;

    //
    // Variables used for updater
    //


    let hasIgnoredUpdate = false;


    //
    // Setup
    //


    log("Script started");


    if (adblocker) removeAds();
    if (removePopup) popupRemover();
    if (updateCheck) checkForUpdate();


    // Remove YouTube's adblock enforcement popup (only when present)
    function popupRemover() {
        let lastPlayAt = 0;

        setInterval(() => {
            const video = document.querySelector('video');
            if (!video) return;

            const overlay = document.querySelector('tp-yt-iron-overlay-backdrop');
            const popup = document.querySelector("ytd-enforcement-message-view-model, .style-scope.ytd-enforcement-message-view-model");
            const popupButton = document.getElementById("dismiss-button");

            // Nothing blocking -> do not touch the player (never steal pause/seek)
            if (!popup && !(overlay && overlay.hasAttribute('opened'))) return;

            log("Popup detected, removing...");

            if (popupButton) popupButton.click();

            if (popup) popup.remove();
            if (overlay) {
                overlay.removeAttribute("opened");
                overlay.remove();
            }

            document.body.style.setProperty('overflow-y', 'auto', 'important');

            if (Date.now() - lastPlayAt > 1000) {
                lastPlayAt = Date.now();
                const p = video.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }

            log("Popup removed");
        }, 1000);
    }


    // undetected adblocker method
    function removeAds() {
        log("removeAds()");


        setGoogleAdStatus("startup");


        // Configurable so the SPA can be re-instrumented and so descriptors stay
        // native-looking; the getter always answers 1.
        try {
            Object.defineProperty(window, 'google_ad_status', {
                configurable: true,
                enumerable: true,
                get() {
                    return 1;
                },
                set(value) {
                    // accepted, but reads still report 1
                }
            });

            log("google_ad_status lock installed");
        } catch (error) {
            log("Unable to lock google_ad_status", "error", error);
            setGoogleAdStatus("fallback after lock failed");
        }


        hookUrlChanges();


        setInterval(() => {
            checkUrlChange("interval check");
            setGoogleAdStatus("interval keep alive");
            removePageAds();
        }, 1000);


        removePageAds();
    }


    //
    // logic functions
    //


    function setGoogleAdStatus(reason) {
        try {
            window.google_ad_status = 1;
            log("Set window.google_ad_status = 1 (" + reason + ")");
        } catch (error) {
            log("Failed to set window.google_ad_status", "error", error);
        }
    }


    function forceRefresh(reason) {
        if (isReloading) return;

        isReloading = true;
        setGoogleAdStatus("before forced refresh");

        log("URL changed, forcing full refresh (" + reason + ")");

        window.location.reload();
    }


    function checkUrlChange(reason) {
        const key = videoKey();

        // Same video (only t=/pp=/index= churn) -> nothing to do
        if (key === currentKey) return;

        currentKey = key;

        // Inside a playlist YouTube already swapped the player via SPA.
        // Reloading here is what caused the endless refresh on the 2nd video.
        if (location.pathname === '/watch' && new URLSearchParams(location.search).has('list')) {
            log("Playlist video switch, staying on SPA (" + reason + ")");
            setGoogleAdStatus(reason);
            removePageAds();
            return;
        }

        if (!/^\/watch/.test(location.pathname)) {
            // Regular navigation between non-watch pages: no reload needed
            setGoogleAdStatus(reason);
            return;
        }

        if (Date.now() - lastReloadAt < 5000) {
            log("Reload suppressed (debounce) (" + reason + ")");
            return;
        }

        lastReloadAt = Date.now();
        forceRefresh(reason);
    }


    function scheduleCheck(reason) {
        if (checkTimer) return;
        checkTimer = setTimeout(() => {
            checkTimer = 0;
            checkUrlChange(reason);
        }, 250);
    }


    function hookUrlChanges() {
        const originalPushState = history.pushState;
        history.pushState = function (...args) {
            setGoogleAdStatus("before history.pushState");


            const result = originalPushState.apply(this, args);


            scheduleCheck("history.pushState");


            return result;
        };


        const originalReplaceState = history.replaceState;
        history.replaceState = function (...args) {
            setGoogleAdStatus("before history.replaceState");


            const result = originalReplaceState.apply(this, args);


            scheduleCheck("history.replaceState");


            return result;
        };


        window.addEventListener('popstate', () => {
            setGoogleAdStatus("popstate");
            scheduleCheck("popstate");
        }, true);


        document.addEventListener('yt-navigate-start', () => {
            setGoogleAdStatus("yt-navigate-start");
            scheduleCheck("yt-navigate-start");
        }, true);


        document.addEventListener('yt-navigate-finish', () => {
            setGoogleAdStatus("yt-navigate-finish");
            scheduleCheck("yt-navigate-finish");
        }, true);

        // yt-page-data-updated intentionally NOT hooked: it fires many times per
        // video (metadata, comments, chat) and caused spurious reloads.


        log("URL change hooks installed");
    }


    //removes ads on the page (not video player ads)
    function removePageAds(){


        const sponsor = document.querySelectorAll("div#player-ads.style-scope.ytd-watch-flexy, div#panels.style-scope.ytd-watch-flexy");


        if (!document.getElementById("remove-adblock-thing-style")) {
            const style = document.createElement('style');
            style.id = "remove-adblock-thing-style";


            style.textContent = `
            ytd-action-companion-ad-renderer,
            ytd-display-ad-renderer,
            ytd-video-masthead-ad-advertiser-info-renderer,
            ytd-video-masthead-ad-primary-video-renderer,
            ytd-in-feed-ad-layout-renderer,
            ytd-ad-slot-renderer,
            yt-about-this-ad-renderer,
            yt-mealbar-promo-renderer,
            ytd-statement-banner-renderer,
            ytd-ad-slot-renderer,
            ytd-in-feed-ad-layout-renderer,
            ytd-banner-promo-renderer-background
            statement-banner-style-type-compact,
            .ytd-video-masthead-ad-v3-renderer,
            div#root.style-scope.ytd-display-ad-renderer.yt-simple-endpoint,
            div#sparkles-container.style-scope.ytd-promoted-sparkles-web-renderer,
            div#main-container.style-scope.ytd-promoted-video-renderer,
            div#player-ads.style-scope.ytd-watch-flexy,
            ad-slot-renderer,
            ytm-promoted-sparkles-web-renderer,
            masthead-ad,


            #masthead-ad {
            display: none !important;
            }
            `;


            (document.head || document.documentElement).appendChild(style);
        }


        sponsor?.forEach((element) => {
            if (element.getAttribute("id") === "rendering-content") {
                element.childNodes?.forEach((childElement) => {
                    if (childElement?.data.targetId && childElement?.data.targetId !=="engagement-panel-macro-markers-description-chapters"){
                        //Skipping the Chapters section
                        element.style.display = 'none';
                    }
                });
            }
        });


        if (document.querySelector("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, div#player-ads")) {
            log("Removed page ads (✔️)");
        }
    }


    //
    // Update check (disabled by default in this fixed build; kept intact)
    //


    function checkForUpdate(){
        if (window.top !== window.self && !(window.location.href.includes("youtube.com"))){
            return;
        }

        if (hasIgnoredUpdate){
            return;
        }

        const scriptUrl = 'https://raw.githubusercontent.com/TheRealJoelmatic/RemoveAdblockThing/main/Youtube-Ad-blocker-Reminder-Remover.user.js';

        fetch(scriptUrl)
        .then(response => response.text())
        .then(data => {
            // Extract version from the script on GitHub
            const match = data.match(/@version\s+(\d+\.\d+)/);
            if (!match) {
                log("Unable to extract version from the GitHub script.", "e")
                return;
            }

            const githubVersion = parseFloat(match[1]);
            const currentVersion = typeof GM_info !== "undefined" ? parseFloat(GM_info.script.version) : 6.0;

            if (githubVersion <= currentVersion) {
                log('You have the latest version of the script. ' + githubVersion + " : " + currentVersion);
                return;
            }

            console.log('Remove Adblock Thing: A new version is available. Please update your script. ' + githubVersion + " : " + currentVersion);

            if(updateModal.enable && typeof Swal !== "undefined"){
                // if a version is skipped, don't show the update message again until the next version
                if (parseFloat(localStorage.getItem('skipRemoveAdblockThingVersion')) === githubVersion) {
                    return;
                }

                Swal.fire({
                    position: "top-end",
                    backdrop: false,
                    title: 'Remove Adblock Thing: New version is available.',
                    text: 'Do you want to update?',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: 'Update',
                    denyButtonText:'Skip',
                    cancelButtonText: 'Close',
                    timer: updateModal.timer ?? 5000,
                    timerProgressBar: true,
                    didOpen: (modal) => {
                        modal.onmouseenter = Swal.stopTimer;
                        modal.onmouseleave = Swal.resumeTimer;
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.location.replace(scriptUrl);
                    } else if(result.isDenied) {
                        localStorage.setItem('skipRemoveAdblockThingVersion', githubVersion);
                    }
                });
            } else {
                // YouTube blocks setting script.src because of Trusted Types.
                // Use the default browser popup instead of loading SweetAlert2 here.
                var result = window.confirm("Remove Adblock Thing: A new version is available. Please update your script.");

                if (result) {
                    window.location.replace(scriptUrl);
                }
            }
        })
        .catch(error => {
            hasIgnoredUpdate = true;
            log("Error checking for updates:", "e", error)
        });
        hasIgnoredUpdate = true;
    }


    // Used for debug messages
    function log(log, level, ...args) {
        if(!debugMessages)
            return;

        const prefix = '🔧 Remove Adblock Thing:';
        const message = `${prefix} ${log}`;
        switch (level) {
            case 'error':
            case 'e':
                console.error(`❌ ${message}`, ...args);
                break;
            case 'log':
                console.log(`✅ ${message}`, ...args);
                break;
            case 'warning':
            case 'w':
                console.warn(`⚠️ ${message}`, ...args);
                break;
            default:
                console.info(`ℹ️ ${message}`, ...args);
        }
    }


})();
