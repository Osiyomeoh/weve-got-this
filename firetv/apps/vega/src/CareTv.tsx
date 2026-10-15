import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from '@amazon-devices/webview';

/**
 * The family's TV, as the sim shows it: the same /tv page the world hangs on its wall and
 * the Fire OS app opens. The remote drives it the same way: the D-pad moves between what
 * needs an owner, OK records a dose or takes one on, BACK goes back.
 *
 * Loading the page gives this set its own copy of the demo, as a browser gets, so a press
 * here never writes to a real family's record.
 */
const TV_URL = 'https://krqi2tpsif.us-east-1.awsapprunner.com/tv';

export default function CareTv() {
  return (
    <View style={styles.root}>
      <WebView
        source={{ uri: TV_URL }}
        javaScriptEnabled
        domStorageEnabled
        allowSystemKeyEvents
        hasTVPreferredFocus
        style={styles.root}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#05070d' } });
