// server.js
// where your nod          for (let i = 0; i <=e app starts

// init project
var express = require('express')
var app = express()
var soap = require('soap')
var moment = require('moment')
var compression = require('compression')
const request = require('request')
require('dotenv').config()
// we've started you off with Express,
// but feel free to use whatever libs or frameworks you'd like through `package.json`.
app.use(compression())
// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'))

// ejs
app.set('views', __dirname + '/views')
app.set('view engine', 'ejs')

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function (request, response) {
  response.render('index')
})

// listen for requests :)
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port)
})

app.get('/station/:triplet', function (request, response) {
  var errors = []
  getStationData(request.params.triplet, function (err, stationData) {
    if (err) {
      errors.push(err)
      stationData = null
    }
    getSeasonalData(request.params.triplet, 'SNWD', function (err, season) {
      if (err) {
        errors.push(err)
        season = null
      }
      getGranularData(request.params.triplet, 'SNWD', function (err, snwdGranular) {
        if (err) {
          errors.push(err)
          snwdGranular = null
        }
        getGranularData(request.params.triplet, 'TOBS', function (err, tavgGranular) {
          if (err) {
            errors.push(err)
            tavgGranular = null
          }
          getGranularData(request.params.triplet, 'WTEQ', function (err, wteqGranular) {
            if (err) {
              errors.push(err)
              wteqGranular = null
            }
            getForecastData(stationData.lat, stationData.long, function (err, forecastData) {
              if (err) {
                errors.push(err)
                forecastData = null
              }
              response.render('station', {
                stationData: stationData,
                season: season,
                snwdGranular: snwdGranular,
                tavgGranular: tavgGranular,
                wteqGranular: wteqGranular,
                forecastData: forecastData,
                errors: errors
              })
            })
          })
        })
      })
    })
  })
})

function inSeason (d) {
  // remember that months are zero indexed
  var seasonStart = 10 // november
  var seasonEnd = 4 // may
  return (d.month() >= seasonStart || d.month() <= seasonEnd)
}

function lastSeasonYear (d) {
  var lastYear = d.year()
  // remember that months are zero indexed
  var seasonStart = 10 // november
  if (d.month() >= seasonStart) { lastYear++ }
  return lastYear
}

function getSeasonalData (triplet, elementCd, callback) {
  var url = 'https://wcc.sc.egov.usda.gov/awdbWebService/services?WSDL'
  var endDate = moment()
  // if today is out of season set the end date to the last day in may of this year
  if (!inSeason(endDate)) { endDate = lastSeasonYear(endDate).toString() + '-05-31' }
  var beginDate = moment((lastSeasonYear(endDate) - 4).toString() + '-11-01')
  var args = {
    stationTriplets: triplet,
    elementCd: elementCd,
    ordinal: '1',
    duration: 'DAILY',
    getFlags: 'false',
    beginDate: beginDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
    alwaysReturnDailyFeb29: 'false'
  }

  soap.createClient(url, function (err, client) {
    if (err) {
      callback('Error creating SOAP client for ' + triplet + ' on ' + elementCd)
      return
    }
    client.getData(args, function (err, result) {
      if (err || !result.return[0].values) {
        callback('Error getting snotel data from ' + triplet + ' on ' + elementCd)
        return
      }
      var snotelData = result.return[0]
      var soapBeginDate = result.return[0].beginDate
      var soapEndDate = result.return[0].endDate
      var incDate = new Date(soapBeginDate)
      snotelData.dateTime = [snotelData.values.length]
      for (let i = 0; i < snotelData.values.length; i++) {
        snotelData.dateTime[i] = new Date(incDate)
        incDate.setDate(incDate.getDate() + 1)
      }

      var seasonData = [4]
      seasonData[0] = []
      seasonData[1] = []
      seasonData[2] = []
      seasonData[3] = []

      var seasonTitles = [4]
          // set the 4 season titles using i as an offset of the current year
      for (let i = 0; i < seasonTitles.length; i++) {
        seasonTitles[i] = (endDate.year() - 1 - i).toString() + '-' + (endDate.year() - i).toString()
      }

      for (let i = 0; i < snotelData.values.length; i++) {
        if (inSeason(moment(snotelData.dateTime[i]))) {
          var tempDate = moment(snotelData.dateTime[i])
          if (tempDate.month() >= 10) { tempDate.year(1970) } else { tempDate.year(1971) }
              // place the data into the proper season array using j as an offset from the current year
          for (let j = 0; j < seasonData.length; j++) {
            if (moment(snotelData.dateTime[i]).isBetween((endDate.year() - 1 - j).toString() + '-11-01', (endDate.year() - j).toString() + '-5-31')) {
              seasonData[j].push({dateTime: tempDate, value: snotelData.values[i]})
            }
          }
        }
      }

      callback(null, {seasonData: seasonData, seasonTitles: seasonTitles})
    })
  })
}

function getGranularData (triplet, elementCd, callback) {
  var url = 'https://wcc.sc.egov.usda.gov/awdbWebService/services?WSDL'
  var endDate = moment().format('YYYY-MM-DD')
  var beginDate = moment().subtract(7, 'days').format('YYYY-MM-DD')
  var args = {
    stationTriplets: triplet,
    elementCd: elementCd,
    ordinal: '1',
    beginDate: beginDate,
    endDate: endDate,
    beginHour: '0',
    endHour: '24'
  }

  soap.createClient(url, function (err, client) {
    if (err) {
      callback('Error creating SOAP client for ' + triplet + ' on ' + elementCd)
      return
    }
    client.getHourlyData(args, function (err, result) {
      if (err || !result.return[0].values) {
        callback('Error getting snotel data from ' + triplet + ' on ' + elementCd)
        return
      }
      var granular = result.return[0].values
      callback(null, granular)
    })
  })
}

function getStationData (triplet, callback) {
  var url = 'https://wcc.sc.egov.usda.gov/awdbWebService/services?WSDL'
  var args = {
    stationTriplet: triplet
  }

  soap.createClient(url, function (err, client) {
    if (err) {
      callback('Error creating SOAP client for ' + triplet)
      return
    }
    client.getStationMetadata(args, function (err, result) {
      if (err || !result.return.name) {
        callback('Error getting snotel station data from ' + triplet)
        return
      }
      var stationData = {
        name: result.return.name,
        lat: result.return.latitude,
        long: result.return.longitude,
        elevation: result.return.elevation,
        triplet: result.return.stationTriplet
      }
      callback(null, stationData)
    })
  })
}

function getForecastData (lat, long, callback) {
  request('https://api.darksky.net/forecast/' + process.env.DARK_SKY + '/' + lat + ',' + long + '?extend=hourly', { json: true }, (err, res, body) => {
    if (err || !body.daily.data) {
      callback('Error getting forecast weather data from Dark Sky')
      return
    }
    var rawForecastData = body
    var forecastData = {daily: []}
    // process daily
    for (let i = 0; i < rawForecastData.daily.data.length; i++) {
      var precipAccumulation = 0
      if (rawForecastData.daily.data[i].precipAccumulation) { precipAccumulation = rawForecastData.daily.data[i].precipAccumulation }
      forecastData.daily.push(
        {
          time: moment.unix(rawForecastData.daily.data[i].time),
          precipAccumulation: precipAccumulation,
          summary: rawForecastData.daily.data[i].summary,
          hourly: []
        }
    )
    }
   // process hourly
    for (let i = 0; i < rawForecastData.hourly.data.length; i++) {
      precipAccumulation = 0
      var hourlyDate = moment.unix(rawForecastData.hourly.data[i].time)
      if (rawForecastData.hourly.data[i].precipAccumulation) { precipAccumulation = rawForecastData.hourly.data[i].precipAccumulation }
      for (let j = 0; j < forecastData.daily.length; j++) {
        if (hourlyDate.day() === forecastData.daily[j].time.day()) {
          forecastData.daily[j].hourly.push(
            {
              time: hourlyDate,
              precipAccumulation: precipAccumulation,
              summary: rawForecastData.hourly.data[i].summary

            }
         )
        }
      }
    }

    callback(null, forecastData)
  })
}
