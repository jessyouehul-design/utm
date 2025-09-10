/*! utm-ghl.js — All-in-one UTM for GoHighLevel (MIT) */
(function(){
  "use strict";
  var DEBUG = false; // passe à true pour voir les logs dans la console
  var STORE_KEY = "am_utm_store_v1";
  var SESSION_KEY = "am_utm_session_v1";
  var PARAMS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content",
                "gclid","fbclid","msclkid","wbraid","gbraid","ttclid"];
  var TTL_DAYS = 90, SESSION_TTL_MIN = 30;

  function log(){ if(DEBUG && window.console) try{ console.log.apply(console, ["[UTM]"].concat([].slice.call(arguments))); }catch(e){} }
  function now(){ return Date.now(); }
  function days(d){ return d*864e5; }
  function minutes(m){ return m*6e4; }
  function nowIso(){ return new Date().toISOString(); }
  function parseQuery(q){ if(!q) return {}; var o={}; (q[0]==="?"?q.slice(1):q).split("&").forEach(function(kv){
    if(!kv) return; var p=kv.split("="),k=decodeURIComponent(p[0]||"").trim(),
    v=decodeURIComponent((p[1]||"").replace(/\+/g," ")||"").trim(); if(k) o[k]=v; }); return o; }
  function getRefMed(ref){ if(!ref) return "direct"; try{ var h=new URL(ref).hostname.toLowerCase();
    if(/google\./.test(h)||/bing\.com|yahoo\.com|duckduckgo\.com/.test(h)) return "organic";
    if(/facebook\.com|instagram\.com|t\.co|x\.com|twitter\.com|linkedin\.com|pinterest\.com|tiktok\.com/.test(h)) return "social";
    return "referral"; }catch(e){ return "referral"; } }
  function safeLS(){ try{ var k="__t"+Math.random(); localStorage.setItem(k,"1"); localStorage.removeItem(k); return localStorage; }catch(e){ return null; } }
  var LS = safeLS();  function read(k){ try{ return LS?JSON.parse(LS.getItem(k)||"null"):null; }catch(e){ return null; } }
  function write(k,v){ if(!LS) return; try{ LS.setItem(k, JSON.stringify(v)); }catch(e){} }
  function remove(k){ if(!LS) return; try{ LS.removeItem(k); }catch(e){} }
  function pick(obj, keys){ var out={}; keys.forEach(function(k){ if(obj[k]!=null && obj[k]!=="") out[k]=String(obj[k]); }); return out; }

  /* --- CAPTURE & PERSIST --- */
  function capture(){
    var urlParams = parseQuery(location.search);
    var picked = pick(urlParams, PARAMS);

    var sess = read(SESSION_KEY), needNew = true;
    if(sess && sess.session_id && sess.last_seen && (now()-sess.last_seen)<minutes(SESSION_TTL_MIN)){
      needNew=false; sess.last_seen=now();
    }
    if(needNew){ sess = { session_id: "sess_"+Math.random().toString(36).slice(2)+now().toString(36), started_at: now(), last_seen: now() }; }
    write(SESSION_KEY, sess);

    var store = read(STORE_KEY) || { first_touch:null, last_touch:null, created_at:now(), updated_at:now(), expires_at: now()+days(TTL_DAYS) };

    if(Object.keys(picked).length>0){
      var ref = document.referrer || "", refHost=""; try{ refHost = ref? new URL(ref).hostname : ""; }catch(e){}
      var refMed = getRefMed(ref);
      var touch = { params:picked, landing_page:location.href.split("#")[0], landing_timestamp:nowIso(),
                    referrer:ref, referrer_host:refHost, referrer_medium:refMed, session_id:sess.session_id };
      if(!store.first_touch) store.first_touch = JSON.parse(JSON.stringify(touch));
      store.last_touch = touch; store.updated_at = now(); store.expires_at = now()+days(TTL_DAYS);
      write(STORE_KEY, store);
      log("captured", picked);
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({event:"utm_persist_capture", utm_first_touch:store.first_touch?store.first_touch.params:{},
                             utm_last_touch:store.last_touch?store.last_touch.params:{}, session_id:sess.session_id,
                             landing_page:touch.landing_page, referrer_medium:refMed});
    }else{
      if(store && store.expires_at && store.expires_at < now()){ remove(STORE_KEY); log("store expired"); }
      else if(store){ store.updated_at=now(); write(STORE_KEY,store); }
    }
  }

  /* --- RESTORE UTM IN URL (pages suivantes) --- */
  function restoreUrlFromStore(){
    try{
      var s = read(STORE_KEY); if(!s) return;
      var last = (s.last_touch && s.last_touch.params) || {};
      if(!Object.keys(last).length) return;
      var u = new URL(location.href); var hasAny=false;
      u.searchParams.forEach(function(v,k){ if(/^utm_|^(gclid|fbclid|msclkid|wbraid|gbraid|ttclid)$/.test(k)) hasAny=true; });
      if(hasAny) return;
      Object.keys(last).forEach(function(k){ if(!u.searchParams.has(k)) u.searchParams.set(k, last[k]); });
      history.replaceState(null, "", u.toString());
      log("url restored with UTM");
    }catch(e){}
  }

  /* --- APPEND UTM TO LINKS/BUTTONS --- */
  function autoAppendLinks(){
    var s = read(STORE_KEY); var last = (s && s.last_touch && s.last_touch.params) || {};
    if(!Object.keys(last).length) return;
    var host = location.hostname;
    function merge(href){
      try{ var u = new URL(href, location.origin); if(u.hostname!==host) return href;
        Object.keys(last).forEach(function(k){ if(!u.searchParams.has(k)) u.searchParams.set(k, last[k]); });
        return u.toString();
      }catch(e){ return href; }
    }
    document.querySelectorAll('a[href]').forEach(function(a){
      var h = a.getAttribute('href'); if(!h || /^(mailto:|tel:|#)/i.test(h)) return;
      a.setAttribute('href', merge(a.href));
    });
    document.addEventListener('click', function(e){
      var el = e.target.closest('[data-element-type="button"],button'); if(!el) return;
      var link = el.getAttribute('href') || el.getAttribute('data-href'); if(!link) return;
      var nh = merge(link);
      if(el.hasAttribute('data-href')) el.setAttribute('data-href', nh);
      if(el.hasAttribute('href')) el.setAttribute('href', nh);
    }, true);
    log("links decorated");
  }

  /* --- INJECT INTO FORMS BEFORE SUBMIT --- */
  var GHL_KEYS = { utm_source:"utm_source",utm_medium:"utm_medium",utm_campaign:"utm_campaign",utm_term:"utm_term",
                   utm_content:"utm_content",gclid:"gclid",fbclid:"fbclid",msclkid:"msclkid",wbraid:"wbraid",
                   gbraid:"gbraid",ttclid:"ttclid",landing_page:"landing_page",landing_timestamp:"landing_timestamp",
                   referrer_host:"referrer_host",referrer_medium:"referrer_medium",session_id:"session_id" };

  function values(){
    var s = read(STORE_KEY) || {};
    var last = (s.last_touch && s.last_touch.params) || {};
    var d = {
      landing_page: (s.last_touch && s.last_touch.landing_page) || (s.first_touch && s.first_touch.landing_page) || location.href.split("#")[0],
      landing_timestamp: (s.last_touch && s.last_touch.landing_timestamp) || (s.first_touch && s.first_touch.landing_timestamp) || nowIso(),
      referrer_host: (s.last_touch && s.last_touch.referrer_host) || (s.first_touch && s.first_touch.referrer_host) || "",
      referrer_medium: (s.last_touch && s.last_touch.referrer_medium) || (s.first_touch && s.first_touch.referrer_medium) || getRefMed(document.referrer),
      session_id: (read(SESSION_KEY) && read(SESSION_KEY).session_id) || ""
    };
    var sp = new URLSearchParams(location.search);
    sp.forEach(function(v,k){ if(/^utm_|^(gclid|fbclid|msclkid|wbraid|gbraid|ttclid)$/.test(k) && !last[k]) last[k]=v; });
    return {last:last, derived:d};
  }

  function ensureHidden(form, apiKey, value){
    if(!value) return;
    var name = 'custom_values['+ apiKey +']';
    var ex = form.querySelector('[name="'+name+'"]');
    if(!ex){
      var h = document.createElement('input'); h.type='hidden'; h.name=name; h.value=value; form.appendChild(h);
    }else{
      ex.value = value;
    }
  }

  function injectInto(form){
    var v = values(); var map = Object.assign({}, v.last, v.derived);
    Object.keys(GHL_KEYS).forEach(function(k){ var api=GHL_KEYS[k]; ensureHidden(form, api, map[k] || ""); });
  }

  function bindForms(root){
    (root||document).querySelectorAll('form').forEach(function(form){
      if(form.__utmBound) return; form.__utmBound = true;
      form.addEventListener('submit', function(){ injectInto(form); log("injected into form"); }, true);
    });
  }

  /* --- BOOT --- */
  capture();
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", function(){
      restoreUrlFromStore(); autoAppendLinks(); bindForms(document);
    });
  }else{
    restoreUrlFromStore(); autoAppendLinks(); bindForms(document);
  }
  if("MutationObserver" in window){
    new MutationObserver(function(muts){
      var found = muts.some(function(m){
        return Array.from(m.addedNodes||[]).some(function(n){ return n.nodeType===1 && (n.tagName==="FORM" || (n.querySelector && n.querySelector("form"))); });
      });
      if(found) bindForms(document);
    }).observe(document.documentElement, {childList:true, subtree:true});
  }

  // Helpers debug
  window.GHL_UTM = {
    getStore: function(){ return read(STORE_KEY); },
    getSession: function(){ return read(SESSION_KEY); },
    clear: function(){ remove(STORE_KEY); remove(SESSION_KEY); }
  };
})();


