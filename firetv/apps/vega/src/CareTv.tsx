import React, { useEffect, useState } from 'react';
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
const RETRY_MS = 4000;

export default function CareTv() {
  // A set switched on before its network is up gets an error page once. Load again after a
  // pause, by mounting a fresh WebView, until the page arrives.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed) return;
    const id = setTimeout(() => {
      setFailed(false);
      setAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(id);
  }, [failed]);

  return (
    <View style={styles.root}>
      <WebView
        key={attempt}
        source={{ uri: TV_URL }}
        javaScriptEnabled
        domStorageEnabled
        allowSystemKeyEvents
        hasTVPreferredFocus
        onError={() => setFailed(true)}
        onHttpError={(e) => {
          if (e.nativeEvent.isMainFrame && e.nativeEvent.statusCode >= 500) setFailed(true);
        }}
        style={styles.root}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#05070d' } });
