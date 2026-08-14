import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#12A99A', // Teal
          'on-primary': '#FFFFFF',
          secondary: '#2C3238', // Antracit
          accent: '#4DB6AC',
          error: '#FF5252',
          info: '#0284C7',
          'on-info': '#FFFFFF',
          success: '#16A34A',
          'on-success': '#FFFFFF',
          warning: '#FFC107',
          background: '#FFFFFF', // Paper
          surface: '#FFFFFF', // Paper
        },
      },
    },
  },
  defaults: {
    VBtn: {
      elevation: 0,
    },
    VCard: {
      elevation: 1,
    },
  },
});
