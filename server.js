'Use strict'

//Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');


//Global vars
const PORT = process.env.PORT || 3001;

const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', error => {
  console.error(error);
})

//Apps
const app = express();
app.use(cors());


//Routes
app.get('/location', searchToLatLng);
app.get('/weather', searchWeather);
app.get('/events', searchEvents);
app.use('*', (req, res) => {
  res.send('You got in the wrong place')
})


/******************-----CONSTRUCTOR--------**************************/

function FormattedLocation(query, data) {
  this.search_query = query;
  this.formatted_query = data.results[0].formatted_address;
  this.latitude = data.results[0].geometry.location.lat;
  this.longitude = data.results[0].geometry.location.lng
}

function FormattedDailyWeather(data) {
  this.forecast = data.summary;
  this.time = new Date(data.time * 1000).toDateString();
}

function FormattedEvent(data) {
  this.name = data.name.text;
  this.link = data.url;
  this.event_date = new Date(data.start.local).toDateString();
  this.summary = data.description.text;
}
/******************-----CONSTRUCTOR--------**************************/

/******************---ROUTES--------**************************/
function searchToLatLng(request, response) {
  let locationName = request.query.data || 'seattle';
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${locationName}&key=${process.env.GEOCODE_API_KEY}`;

  getLocation(locationName, response, url); //Get location
}


function searchWeather(request, response) {
  let locationName = request.query.data.search_query;
  let location_id;
  let lat = request.query.data.latitude;
  let long = request.query.data.longitude;
  let weatherLocation = `${lat},${long}` || '37.8267,-122.4233';
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${weatherLocation}`;

  client.query(`SELECT id FROM locations WHERE search_query=$1`, [locationName])
    .then(sqlResult => {
      location_id = sqlResult.rows[0].id; //Gets the recent ID that has been added
      console.log('location ID: ', location_id)
      addWeatherSendResponse(location_id, response, url); //Add weather and send response
    }).catch(e => {
      console.log(e);
      response.status(500).send('STATUS 500');
    })

}

function searchEvents(request, response) {
  let lat = request.query.data.latitude;
  let long = request.query.data.longitude;
  const url = `https://www.eventbriteapi.com/v3/events/search/?token=${process.env.EVENTBRITE_API_KEY}&location.latitude=${lat}&location.longitude=${long}`
  superagent.get(url)
    .then(result => {
      let arrayOfFormattedEvents = result.body.events.map(item => {
        return new FormattedEvent(item);
      })

      response.send(arrayOfFormattedEvents);

    }).catch(e => {
      console.log(e);
      response.status(500).send('Status 500');
    })
}

/******************---ROUTES--------**************************/


/******************---HELPER FUNCTIONS--------**************************/

function addWeatherSendResponse(location_id, response, url) {

  client.query(`SELECT * FROM weather WHERE location_id=$1`, [location_id])
    .then(sqlResult => {
      if (sqlResult.rowCount === 0) {
        superagent.get(url)
          .then(result => {
            let forecastArr = result.body.daily.data.map(el => {
              return new FormattedDailyWeather(el);
            })
            console.log('weather log id: ', location_id);
            client.query(
              `INSERT INTO weather (
                forecast,
                time,
                location_id) VALUES($1, $2, $3)`, [forecastArr[0].forecast, forecastArr[0].time, location_id])

            //send response to the client
            response.send(forecastArr);
          }).catch(e => {
            console.error(e);
            response.status(500).send('STATUS 500');
          })

      } else {
        getWeatherFromDB(location_id, response);
      }
    }).catch(e => {
      console.error(e);
    })

}

function getWeatherFromDB(locationId, response) {
  console.log('Sending weather from DB');
  client.query(`SELECT * FROM weather WHERE location_id=$1`, [locationId])
    .then(sqlResult => {
      response.send(sqlResult.rows[0]);
    })
}

function getLocation(locationName, response, url) {
  client.query(`SELECT * FROM locations WHERE search_query=$1`, [locationName])
    .then(sqlResult => {

      if (sqlResult.rowCount === 0) {
        console.log('getting new data from googles');
        superagent.get(url)
          .then(result => {

            let location = new FormattedLocation(locationName, result.body)
            client.query(
              `INSERT INTO locations (
          search_query,
          formatted_query,
          latitude,
          longitude
        ) VALUES ($1, $2, $3, $4)`,
              [location.search_query, location.formatted_query, location.latitude, location.longitude]
            )
            response.send(location);

          }).catch(e => {
            console.error(e);
            response.status(500).send('Status 500: So sorry i broke');
          })
      } else {
        console.log('sending from db');
        // send the frontend what was in the db
        response.send(sqlResult.rows[0]);
      }
    });
}

/******************---HELPER FUNCTIONS--------**************************/


//Starting Server
app.listen(PORT, () => {
  console.log('listing on port', PORT);
})
