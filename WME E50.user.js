// ==UserScript==
// @name         WME E50 Fetch POI Data
// @version      0.0.9
// @description  Fetch information about the POI from external sources
// @author       Anton Shevchuk
// @license      MIT License
// @include      https://www.waze.com/editor*
// @include      https://www.waze.com/*/editor*
// @include      https://beta.waze.com/editor*
// @include      https://beta.waze.com/*/editor*
// @exclude      https://www.waze.com/user/editor*
// @exclude      https://beta.waze.com/user/editor*
// @grant        none
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @require      https://greasyfork.org/scripts/389117-apihelper/code/APIHelper.js?version=729417
// @require      https://greasyfork.org/scripts/389577-apihelperui/code/APIHelperUI.js?version=729353
// @namespace    https://greasyfork.org/users/227648
// ==/UserScript==

/* jshint esversion: 8 */
/* global require, $, window, W, I18n, OL, APIHelper, APIHelperUI, WazeWrap */
(function () {
  'use strict';

  let helper, panel;
  let vectorLayer, vectorPoint, vectorLine;

  const NAME = 'E50';

  // translation structure
  const TRANSLATION = {
    'en': {
      title: 'Information',
      questions: {
        changeName: 'Are you sure to change the name?',
        changeNumber: 'Are you sure to change the house number?',
      }
    },
    'uk': {
      title: 'Інформація',
      questions: {
        changeName: 'Ви впевненні що хочете змінити им\'я?',
        changeNumber: 'Ви впевненні що хочете змінити номер дома?',
      }
    },
    'ru': {
      title: 'Информация',
      questions: {
        changeName: 'Ви уверены, что хотите изменить имя?',
        changeNumber: 'Ви уверены, что хотите изменить номер дома?',
      }
    }
  };

  // OpenLayer styles
  APIHelper.bootstrap();
  APIHelper.addTranslation(NAME, TRANSLATION);
  APIHelper.addStyle(
    '.e50 legend { cursor:pointer; font-size: 12px; font-weight: bold; width: auto; text-align: right; border: 0; margin: 0; padding: 0 8px; }' +
    '.e50 fieldset { border: 1px solid #ddd; padding: 4px; }' +
    '.e50 ul { padding: 0; margin: 0 }' +
    '.e50 li { padding: 0; margin: 0; list-style: none; margin-bottom: 2px }' +
    '.e50 li a { display: block; padding: 2px 4px; text-decoration: none; border: 1px solid #e4e4e4; }' +
    '.e50 li a:hover { background: #ddd }' +
    '.e50 li a.noaddress { background: rgba(255, 255, 200, 0.5) }' +
    '.e50 li a.noaddress:hover { background: rgba(255, 255, 200, 1) }'
  );

  let WazeActionMultiAction = require('Waze/Action/MultiAction');
  let WazeActionUpdateObject = require('Waze/Action/UpdateObject');
  let WazeActionUpdateFeatureAddress = require('Waze/Action/UpdateFeatureAddress');

  class Cache {
    constructor() {
      this.cache = {};
    }
    set(key, value) {
      this.cache[key] = value;
    }
    get(key) {
      if (this.has(key)) {
        return this.cache[key];
      } else {
        return null;
      }
    }
    has(key) {
      return (typeof this.cache[key] !== 'undefined');
    }
  }

  let E50Cache = new Cache();

  class Provider {
    constructor(uid) {
      this.uid = uid;
    }

    async request(lon, lat) {
      throw new Error('Abstract method');
    }

    async search(lon, lat) {
      try {
        let result;
        let key = this.uid + ':' + lon + ',' + lat;
        if (E50Cache.has(key)) {
          result = E50Cache.get(key);
        } else {
          result = await this.request(lon, lat);
          E50Cache.set(key, result);
        }
        this.collection(result);
      } catch (e) {
        console.error(e);
      }
    }

    panel(parent) {
      let div = document.createElement('div');
      div.id = 'E50-' + this.uid;
      this.container = div;
      parent.append(this.container);
    }

    collection(results) {
      if (results.length === 0) {
        return;
      }
      let fieldset = document.createElement('fieldset');
      let list = document.createElement('ul');
      list.style.display = results.length > 2 ? 'none' : 'block';

      for (let i = 0; i < results.length; i++) {
        let item = document.createElement('li');
            item.append(this.item(results[i]));
        list.append(item);
      }

      let legend = document.createElement('legend');
      legend.innerHTML = this.uid + ' [' + results.length + ']';
      legend.onclick = function () {
        $(this).next().toggle();
        return false;
      };
      fieldset.append(legend, list);
      this.result(fieldset);
    }

    /**
     * Should return {DocumentElement} link
     * @param res
     */
    item(res) {
      throw new Error('Abstract method');
    }

    result(item) {
      this.container.append(item);
      return this;
    }

    link(lon, lat, city, street, number, name = null) {
      let a = document.createElement('a');
          a.href = '#';
          a.dataset.lat = lat;
          a.dataset.lon = lon;
          a.dataset.city = city ? city.trim() : '';
          a.dataset.street = street ? street.trim() : '';
          a.dataset.number = number ? number.trim() : '';
          a.dataset.name = name ? name.trim() : '';
          a.innerHTML = [street, number, name].filter(x => !!x).join(', ');
          a.className = NAME + '-link';
      return a;
    }
  }

  /**
   * Open Street Map
   */
  class OsmProvider extends Provider {
    async request(lon, lat) {
      let url = 'https://nominatim.openstreetmap.org/reverse';
      let data = {
        lon: lon,
        lat: lat,
        zoom: 18,
        addressdetails: 1,
        countrycodes: 'ua',
        'accept-language': 'uk_UA',
        format: 'json',
      };
      let response = await $.ajax({
        dataType: 'json',
        cache: false,
        url: url,
        data: data
      });
      if (!response.address) {
        return [];
      } else {
        return [response];
      }
    }
    item(res) {
      let output = [];
      let city = null;
      let street = null;
      let number = null;
      if (res.address.city) {
        city = res.address.city;
      }
      if (res.address.road) {
        street = res.address.road;
      }
      if (res.address.house_number) {
        number = res.address.house_number;
      } else {
        output.push(res.display_name.split(', ', 1));
      }
      return this.link(res.lon, res.lat, city, street, number, output.join(', '));
    }
  }

  /**
   * 2GIS
   * @link http://catalog.api.2gis.ru/doc/2.0/geo/#/default/get_2_0_geo_search
   */
  class GisProvider extends Provider {
    async request(lon, lat) {
      let url = 'https://catalog.api.2gis.ru/2.0/geo/search';
      let data = {
        point: lon + ',' + lat,
        radius: 20,
        type: 'building',
        fields: 'items.address,items.adm_div,items.geometry.centroid',
        locale: 'uk_UA',
        format: 'json',
        key: 'rubnkm' + '7490',
      };
      let response = await $.ajax({
        dataType: 'json',
        cache: false,
        url: url,
        data: data
      });
      if (!response.result || !response.result.items.length) {
        return [];
      }
      return response.result.items;
    }

    item(res) {
      let output = [];
      let city = null;
      let street = null;
      let number = null;
      if (res.adm_div.length) {
        for (let i = 0; i < res.adm_div.length; i++) {
          if (res.adm_div[i]['type'] === 'city') {
            city = res.adm_div[i]['name'];
          }
        }
      }
      if (res.address.components) { // optional
        street = res.address.components[0].street;
        number = res.address.components[0].number;
      } else if (res.address_name) { // optional
        output.push(res.address_name);
      } else if (res.name) {
        output.push(res.name);
      }
      // e.g. POINT(36.401143 49.916814)
      let center = res.geometry.centroid.substring(6, res.geometry.centroid.length - 1).split(' ');
      let lon = center[0];
      let lat = center[1];

      let link = this.link(lon, lat, city, street, number, output.join(', '));
      if (res.purpose_name) {
        link.title = res.purpose_name;
      }
      return link;
    }
  }

  /**
   * Yandex Maps
   */
  class YMProvider extends Provider {
    async request(lon, lat) {
      let url = 'https://geocode-maps.yandex.ru/1.x/';
      let data = {
        geocode: lon + ',' + lat,
        kind: 'house',
        results: 2,
        lang: 'uk_UA',
        format: 'json',
        apikey: '2fe62c0e' + '-580f-4541-b325-' + '7c896d8d9481',
      };
      let response = await $.ajax({
        dataType: 'json',
        cache: false,
        url: url,
        data: data,
      });
      if (!response.response || !response.response.GeoObjectCollection.featureMember.length) {
        return [];
      }
      return response.response.GeoObjectCollection.featureMember;
    }

    item(res) {
      res = res.GeoObject;
      let center = res.Point.pos.split(' ');
      let lon = center[0];
      let lat = center[1];
      let city = null;
      let street = null;
      let number = null;
      if (res.metaDataProperty.GeocoderMetaData.Address.Components) {
        for (let el in res.metaDataProperty.GeocoderMetaData.Address.Components) {
          if (res.metaDataProperty.GeocoderMetaData.Address.Components[el]['kind'] === 'locality') {
            city = res.metaDataProperty.GeocoderMetaData.Address.Components[el]['name'];
          }
          if (res.metaDataProperty.GeocoderMetaData.Address.Components[el]['kind'] === 'street') {
            street = res.metaDataProperty.GeocoderMetaData.Address.Components[el]['name'];
          }
          if (res.metaDataProperty.GeocoderMetaData.Address.Components[el]['kind'] === 'house') {
            number = res.metaDataProperty.GeocoderMetaData.Address.Components[el]['name'];
          }
        }
      }
      let link = this.link(
        lon,
        lat,
        city,
        street,
        number
      );
      link.title = res.name;
      return link;
    }
  }

  /**
   * Here Maps
   * @link https://developer.here.com/documentation/geocoder/topics/quick-start-geocode.html
   */
  class HereProvider extends Provider {
    async request(lon, lat) {
      let url = 'https://reverse.geocoder.api.here.com/6.2/reversegeocode.json';
      let data = {
        app_id: 'GCFmOOrSp8882vFwTxEm',
        app_code: 'O-LgGkoRfypnRuik0WjX9A',
        prox: lat + ',' + lon + ',10',
        mode: 'retrieveAddresses',
        locationattributes: 'none,ar',
        addressattributes: 'str,hnr'
      };
      let response = await $.ajax({
        dataType: 'json',
        cache: false,
        url: url,
        data: data,
      });
      if (!response.Response || !response.Response.View || !response.Response.View || !response.Response.View[0] || !response.Response.View[0].Result) {
        return [];
      }
      let results = response.Response.View[0].Result;
      return results.filter(x => x.MatchLevel === 'houseNumber');
    }

    item(res) {
      return this.link(
        res.Location.DisplayPosition.Longitude,
        res.Location.DisplayPosition.Latitude,
        res.Location.Address.City,
        res.Location.Address.Street,
        res.Location.Address.HouseNumber
      );
    }
  }

  /**
   * Bing Maps
   * @link https://docs.microsoft.com/en-us/bingmaps/rest-services/locations/find-a-location-by-point
   * http://dev.virtualearth.net/REST/v1/Locations/50.03539,36.34732?o=xml&key=AuBfUY8Y1Nzf3sRgceOYxaIg7obOSaqvs0k5dhXWfZyFpT9ArotYNRK7DQ_qZqZw&c=uk
   * http://dev.virtualearth.net/REST/v1/Locations/50.03539,36.34732?o=xml&key=AuBfUY8Y1Nzf3sRgceOYxaIg7obOSaqvs0k5dhXWfZyFpT9ArotYNRK7DQ_qZqZw&c=uk&includeEntityTypes=Address
   */
  class BingProvider extends Provider {
    async request(lon, lat) {
      let url = 'https://dev.virtualearth.net/REST/v1/Locations/' + lat + ',' + lon;
      let data = {
        includeEntityTypes: 'Address',
        c: 'uk',
        key: 'AuBfUY8Y1Nzf' + '3sRgceOYxaIg7obOSaqvs' + '0k5dhXWfZyFpT9ArotYNRK7DQ_qZqZw',
      };
      let response = await $.ajax({
        dataType: 'json',
        cache: false,
        url: url,
        data: data,
      });
      if (!response || !response.resourceSets || !response.resourceSets[0]) {
        return [];
      }
      return response.resourceSets[0].resources.filter(el => el.address.addressLine.indexOf(',') > 0);
    }
    item(res) {
      let address = res.address.addressLine.split(',');
      return this.link(
        res.point.coordinates[1],
        res.point.coordinates[0],
        res.address.locality,
        address[0],
        address[1]
      );
    }
  }

  /**
   * Google Place
   * @link https://developers.google.com/places/web-service/search
   */
  class GPProvider extends Provider {
    async request(lon, lat) {
      let url = 'https://' + location.hostname + '/maps/api/place/nearbysearch/json';
      let data = {
        location: lat + ',' + lon,
        radius: 40,
        fields: 'geometry,formatted_address',
        types: 'point_of_interest',
        language: 'ua',
        key: 'AIzaSy' + 'CebbES' + 'rWERY1MRZ56gEAfpt7tK2R6hV_I', // extract it from WME
      };
      let response = await $.ajax({
        dataType: 'json',
        cache: false,
        url: url,
        data: data,
      });
      if (!response.results || !response.results.length) {
        return [];
      }
      return response.results;
    }

    item(res) {
      let link = this.link(
        res.geometry.location.lng,
        res.geometry.location.lat,
        null,
        null,
        null,
        res.name
      );
      link.className += ' noaddress';
      link.innerHTML += ', ' + res.vicinity;
      return link;
    }
  }

  $(document)
    .on('ready.apihelper', ready)
    .on('landmark.apihelper', landmarkPanel)
    .on('click', '.' + NAME + '-link', applyData)
    .on('mouseenter', '.' + NAME + '-link', showVector)
    .on('mouseleave', '.' + NAME + '-link', hideVector)
  ;

  function ready() {
    helper = new APIHelperUI(NAME);

    panel = helper.createPanel(I18n.t(NAME).title);

    vectorLayer = new OL.Layer.Vector("E50VectorLayer", {
      displayInLayerSwitcher: false,
      uniqueName: "__E50VectorLayer"
    });
    W.map.addLayer(vectorLayer);
  }

  function landmarkPanel(event, element) {
    let group = panel.toHTML();

    let selected = APIHelper.getSelectedVenues()[0].geometry.getCentroid().clone();
    selected.transform('EPSG:900913', 'EPSG:4326');

    let Osm = new OsmProvider('OSM');
    Osm.panel(group);
    Osm.search(selected.x, selected.y);

    let Gis = new GisProvider('2Gis');
    Gis.panel(group);
    Gis.search(selected.x, selected.y);

    let Yandex = new YMProvider('Yandex');
    Yandex.panel(group);
    Yandex.search(selected.x, selected.y);

    let Here = new HereProvider('Here');
    Here.panel(group);
    Here.search(selected.x, selected.y);

    let Bing = new BingProvider('Bing');
    Bing.panel(group);
    Bing.search(selected.x, selected.y);

    let Google = new GPProvider('Google');
    Google.panel(group);
    Google.search(selected.x, selected.y);

    element.prepend(group);
  }

  function applyData() {
    let poi = APIHelper.getSelectedVenues()[0];
    let name = this.dataset['name'];
    let city = this.dataset['city'];
    let street = normalizeStreet(this.dataset['street']);
    let number = normalizeNumber(this.dataset['number']);

    // POI Name
    let newName;
    // If exists ask user to replace or not
    // If not exists - use name or house number as name
    if (poi.attributes.name) {
      if (name && name !== poi.attributes.name) {
        if (window.confirm(I18n.t(NAME).questions.changeName + '\n«' + poi.attributes.name + '» ⟶ «' + name + '»?')) {
          newName = name;
        }
      } else if (number && number !== poi.attributes.name) {
        if (window.confirm(I18n.t(NAME).questions.changeName + '\n«' + poi.attributes.name + '» ⟶ «' + number + '»?')) {
          newName = number;
        }
      }
    } else {
      if (name) {
        newName = name;
      } else if (number) {
        newName = number;
      }
    }
    if (newName) {
      W.model.actionManager.add(new WazeActionUpdateObject(poi, {name: newName}));
    }

    // POI Address HouseNumber
    let newHN;
    let addressHN = poi.getAddress().attributes.houseNumber;
    if (number) {
      if (addressHN) {
        if (addressHN !== number) {
          if (window.confirm(I18n.t(NAME).questions.changeNumber + '\n«' + addressHN + '» ⟶ «' + number + '»?')) {
            newHN = number;
          }
        }
      } else {
        newHN = number;
      }
      if (newHN) {
        W.model.actionManager.add(new WazeActionUpdateObject(poi, {houseNumber: newHN}));
      }
    }

    // POI Address Street Name
    let newStreet;
    let addressStreet = poi.getAddress().getStreet().name;
    if (street) {
      if (addressStreet) {
        if (addressStreet !== street) {
          if (window.confirm(I18n.t(NAME).questions.changeName + '\n«' + addressStreet + '» ⟶ «' + street + '»?')) {
            newStreet = street;
          }
        }
      } else {
        newStreet = street;
      }
      if (newStreet) {
        let address = {
          countryID: W.model.getTopCountry().getID(),
          stateID: W.model.getTopState().getID(),
          cityName: poi.getAddress().getCityName(),
          streetName: newStreet
        };
        W.model.actionManager.add(new WazeActionUpdateFeatureAddress(poi, address));
      }
    }

    // POI Address City
    let newCity;
    let addressCity = poi.getAddress().getCity().name;
    if (city) {
      if (addressCity) {
        if (addressCity !== city) {
          if (window.confirm(I18n.t(NAME).questions.changeName + '\n«' + addressCity + '» ⟶ «' + city + '»?')) {
            newCity = city;
          }
        }
      } else {
        newCity = city;
      }
      if (newCity) {
        let address = {
          countryID: W.model.getTopCountry().getID(),
          stateID: W.model.getTopState().getID(),
          cityName: newCity,
          streetName: poi.getAddress().getStreetName()
        };
        W.model.actionManager.add(new WazeActionUpdateFeatureAddress(poi, address));
      }
    }

    if (newName || newHN || newStreet || newCity) {
      W.selectionManager.setSelectedModels([poi]);
    }

    // TODO: rewrite it to use multiAction
    /*
    let address = {
      countryID: W.model.getTopCountry().getID(),
      stateID: W.model.getTopState().getID(),
      cityName: poi.getAddress().getCityName(),
      streetName: poi.getAddress().getStreetName(),
      houseNumber: number,
    };
    // Check city
    address.emptyCity = (address.cityName === null);
    // Check street
    address.emptyStreet = (address.streetName === null) || (address.streetName === '');

    let multiAction = new WazeActionMultiAction();
        multiAction.setModel(W.model);

    multiAction.doSubAction(new WazeActionUpdateFeatureAddress(poi, address, {updateHouseNumber: true}));
    multiAction.doSubAction(new WazeActionUpdateObject(poi, {houseNumber: number}));
    W.model.actionManager.add(multiAction);
    */
    return false;
  }

  function normalizeNumber(number) {
    return number;
  }

  function normalizeStreet(street) {
    // let streets = W.model.streets.getObjectArray().filter(m => m.name !== null).map(m => m.name);

    let regs = {
      "(^|.+?) ?бульвар ?(.+|$)": "б-р $1$2",
      "(^|.+?) ?вулиця ?(.+|$)": "вул. $1$2",
      "(^|.+?) ?мікрорайон ?(.+|$)": "мкрн. $1$2",
      "(^|.+?) ?набережна ?(.+|$)": "наб. $1$2",
      "(^|.+?) ?провулок ?(.+|$)": "пров. $1$2",
      "(^|.+?) ?проїзд ?(.+|$)": "пр. $1$2",
      "(^|.+?) ?проспект ?(.+|$)": "просп. $1$2",
      "(^|.+?) ?станція ?(.+|$)": "ст. $1$2",
    };

    for (let key in regs) {
      let re = new RegExp(key, 'i');
      if (re.test(street)) {
        street = street.replace(re, regs[key]);
        break;
      }
    }

    return street;
  }

  function showVector() {
    let from = APIHelper.getSelectedVenues()[0].geometry.getCentroid();
    let to = new OL.Geometry.Point(this.dataset.lon, this.dataset.lat).transform('EPSG:4326', 'EPSG:900913');
    let distance = Math.round(WazeWrap.Geometry.calculateDistance([to, from]));

    vectorLine = new OL.Feature.Vector(new OL.Geometry.LineString([from, to]), {}, {
      strokeWidth: 4,
      strokeColor: '#fff',
      strokeLinecap: 'round',
      strokeDashstyle: 'dash',
      label: distance + 'm',
      labelOutlineColor: '#000',
      labelOutlineWidth: 3,
      labelAlign: 'cm',
      fontColor: '#fff',
      fontSize: '24px',
      fontFamily: 'Courier New, monospace',
      fontWeight: 'bold',
      labelYOffset: 24
    });
    vectorPoint = new OL.Feature.Vector(to, {}, {
      pointRadius: 8,
      fillOpacity: 0.5,
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 2,
      strokeLinecap: 'round'
    });
    vectorLayer.addFeatures([vectorLine, vectorPoint]);
    vectorLayer.setZIndex(1001);
    vectorLayer.setVisibility(true);
  }

  function hideVector() {
    vectorLayer.removeAllFeatures();
    vectorLayer.setVisibility(false);
  }
})();
