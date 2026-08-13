Pod::Spec.new do |s|
  s.name           = 'KameraZoom'
  s.version        = '1.0.0'
  s.summary        = 'Linsen und Zoomfaktor der Kamera'
  s.description    = 'Meldet die Linsen des Geraets samt Umschaltpunkten und setzt den Zoomfaktor direkt.'
  s.author         = 'Reelive'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
