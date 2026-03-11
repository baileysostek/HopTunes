import React from 'react';
import { Button, Box } from '@mui/material';
import { Link } from 'react-router-dom';
import axios from 'axios';

const MediaControls = () => {
  return (
    <Box>
      <Box sx={{ position: 'relative', zIndex: 1}}>
        <Link to="/settings">
          <Button variant="contained" color="primary" style={{ pointerEvents: "auto" }}>Go to Settings</Button>
        </Link>
        <Button onClick={() => {
          axios.get('http://127.0.0.1:3000/api/library')
          .then(function (response) {
            // handle success
            console.log(response);
          })
          .catch(function (error) {
            // handle error
            console.log(error);
          })
          .finally(function () {
            // always executed
          });
        }}>Load Library</Button>
      </Box>
    </Box>
  );
};

export default MediaControls;