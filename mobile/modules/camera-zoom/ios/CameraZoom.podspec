Pod::Spec.new do |s|
  s.name           = 'CameraZoom'
  s.version        = '1.0.0'
  s.summary        = 'Camera lenses and zoom factor'
  s.description    = 'Reports the device lenses with their switch points and sets the zoom factor directly.'
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
