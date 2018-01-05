// server.js
// where your nod          for (let i = 0; i <=e app starts

// init project
var express = require('express')
var app = express()
var soap = require('soap-as-promised')
var moment = require('moment')
var compression = require('compression')
const request = require('request')
const requestPromise = require('request-promise-native')
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

app.get('/station/:triplet', async function (request, response) {
  var errors = []
  const stationData = await getStationData(request.params.triplet)
  const season = await getSeasonalData(request.params.triplet, 'SNWD')
  const snwdGranular = await getGranularData(request.params.triplet, 'SNWD')
  const tavgGranular = await getGranularData(request.params.triplet, 'TOBS')
  const wteqGranular = await getGranularData(request.params.triplet, 'WTEQ')
  const forecastData = await getForecastData(stationData.lat, stationData.long)
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

async function getSeasonalData (triplet, elementCd) {
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

  const client = await soap.createClient(url)
  const result = await client.getData(args)
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
        if (moment(snotelData.dateTime[i]).isBetween(((endDate.year() - 1 - j).toString() + '-11-01'), (endDate.year() - j).toString() + '-5-31')) {
          seasonData[j].push({dateTime: tempDate, value: snotelData.values[i]})
        }
      }
    }
  }

  return {seasonData: seasonData, seasonTitles: seasonTitles}
}

async function getGranularData (triplet, elementCd) {
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

  const client = await soap.createClient(url)
  const result = await client.getHourlyData(args)
  return result.return[0].values
}

async function getStationData (triplet) {
  var url = 'https://wcc.sc.egov.usda.gov/awdbWebService/services?WSDL'
  var args = {
    stationTriplet: triplet
  }

  const client = await soap.createClient(url)
  const result = await client.getStationMetadata(args)
  var stationData = {
    name: result.return.name,
    lat: result.return.latitude,
    long: result.return.longitude,
    elevation: result.return.elevation,
    triplet: result.return.stationTriplet
  }
  return stationData
}

async function getForecastData (lat, long, callback) {
  const body = await requestPromise('https://api.darksky.net/forecast/' + process.env.DARK_SKY + '/' + lat + ',' + long + '?extend=hourly', { json: true })
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

  return forecastData
}
