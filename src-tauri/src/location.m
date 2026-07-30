#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>

#include <stdint.h>

typedef void (*TinyFarmLocationCallback)(double latitude,
                                         double longitude,
                                         int32_t status,
                                         const char *message,
                                         void *context);

@interface TinyFarmLocationRequest : NSObject <CLLocationManagerDelegate>
@property(nonatomic, strong) CLLocationManager *manager;
@property(nonatomic, assign) TinyFarmLocationCallback callback;
@property(nonatomic, assign) void *context;
@property(nonatomic, assign) BOOL completed;
- (instancetype)initWithCallback:(TinyFarmLocationCallback)callback
                          context:(void *)context;
- (void)start;
@end

static NSMutableSet<TinyFarmLocationRequest *> *activeRequests;

/**
 * 권한 요청은 앱이 살아 있는 동안 유지되는 감시자 매니저가 낸다.
 *
 * 한 번짜리 요청 객체가 프롬프트를 띄우면, timeout 으로 그 객체를 정리할 때
 * CoreLocationAgent 가 프롬프트를 함께 철회한다. 그러면 사용자가 답할 시간이 없다.
 */
static void tinyFarmRequestAuthorizationViaWatcher(void);

@implementation TinyFarmLocationRequest

- (instancetype)initWithCallback:(TinyFarmLocationCallback)callback
                          context:(void *)context {
  self = [super init];
  if (self) {
    _callback = callback;
    _context = context;
    _completed = NO;
  }
  return self;
}

- (CLAuthorizationStatus)authorizationStatus {
  if (@available(macOS 11.0, *)) {
    return self.manager.authorizationStatus;
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return [CLLocationManager authorizationStatus];
#pragma clang diagnostic pop
}

- (void)finishWithStatus:(int32_t)status
                latitude:(double)latitude
               longitude:(double)longitude
                 message:(NSString *)message {
  NSAssert([NSThread isMainThread], @"CoreLocation completion must run on the main thread");
  if (self.completed) {
    return;
  }
  self.completed = YES;

  TinyFarmLocationCallback callback = self.callback;
  void *context = self.context;
  self.callback = NULL;
  self.context = NULL;

  [self.manager stopUpdatingLocation];
  self.manager.delegate = nil;
  self.manager = nil;

  // removeObject may release the final external retain. Keep a strong local until the callback ends.
  TinyFarmLocationRequest *keepAlive = self;
  [activeRequests removeObject:keepAlive];
  if (callback != NULL) {
    callback(latitude, longitude, status, message.UTF8String, context);
  }
}

- (void)requestLocationForAuthorizationStatus:(CLAuthorizationStatus)status {
  switch (status) {
    case kCLAuthorizationStatusAuthorized:
      [self.manager requestLocation];
      break;
    case kCLAuthorizationStatusDenied:
      [self finishWithStatus:1
                    latitude:0
                   longitude:0
                     message:@"Tiny Farm의 위치 권한이 거부되었습니다."];
      break;
    case kCLAuthorizationStatusRestricted:
      [self finishWithStatus:1
                    latitude:0
                   longitude:0
                     message:@"macOS에서 위치 사용이 제한되어 있습니다."];
      break;
    case kCLAuthorizationStatusNotDetermined:
      // The authorization callback continues the request after the user answers.
      break;
  }
}

- (void)start {
  NSAssert([NSThread isMainThread], @"CLLocationManager must be created on the main thread");
  if (activeRequests == nil) {
    activeRequests = [[NSMutableSet alloc] init];
  }
  [activeRequests addObject:self];

  if (![CLLocationManager locationServicesEnabled]) {
    [self finishWithStatus:1
                  latitude:0
                 longitude:0
                   message:@"macOS 위치 서비스가 꺼져 있습니다."];
    return;
  }

  self.manager = [[CLLocationManager alloc] init];
  self.manager.delegate = self;
  // Weather does not need a precise GPS fix. Coarse accuracy is faster and uses less power.
  self.manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers;

  CLAuthorizationStatus status = [self authorizationStatus];
  if (status == kCLAuthorizationStatusNotDetermined) {
    // 프롬프트는 오래 사는 감시자 매니저가 띄운다. 이 요청 객체는 곧 정리되므로 여기서
    // 띄우면 프롬프트가 함께 사라진다. 답을 받으면 감시자가 프런트에 알리고 다시 요청한다.
    tinyFarmRequestAuthorizationViaWatcher();
    [self finishWithStatus:3
                  latitude:0
                 longitude:0
                   message:@"위치 권한 응답을 기다리고 있습니다."];
    return;
  }
  [self requestLocationForAuthorizationStatus:status];

  __weak TinyFarmLocationRequest *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(25 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    TinyFarmLocationRequest *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return;
    }
    // 사용자가 프롬프트에 아직 답하지 않은 경우다. 실패로 취급해 재시도하면 프롬프트가
    // 반복해서 뜬다. 별도 상태로 알려 자동 재요청을 멈춘다.
    if ([strongSelf authorizationStatus] == kCLAuthorizationStatusNotDetermined) {
      [strongSelf finishWithStatus:3
                          latitude:0
                         longitude:0
                           message:@"위치 권한 응답을 기다리고 있습니다."];
      return;
    }
    [strongSelf finishWithStatus:2
                        latitude:0
                       longitude:0
                         message:@"현재 위치 요청 시간이 초과되었습니다."];
  });
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
  [self requestLocationForAuthorizationStatus:[self authorizationStatus]];
}

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-implementations"
- (void)locationManager:(CLLocationManager *)manager
    didChangeAuthorizationStatus:(CLAuthorizationStatus)status {
  [self requestLocationForAuthorizationStatus:status];
}
#pragma clang diagnostic pop

- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations {
  CLLocation *location = locations.lastObject;
  if (location == nil || location.horizontalAccuracy < 0) {
    [self finishWithStatus:2
                  latitude:0
                 longitude:0
                   message:@"macOS가 유효한 현재 위치를 반환하지 않았습니다."];
    return;
  }
  [self finishWithStatus:0
                latitude:location.coordinate.latitude
               longitude:location.coordinate.longitude
                 message:@""];
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  // 프롬프트가 떠 있는 동안 macOS 가 먼저 오류를 주는 경우가 있다. 아직 결정 전이므로
  // 거부로 확정하지 않는다.
  if ([self authorizationStatus] == kCLAuthorizationStatusNotDetermined) {
    [self finishWithStatus:3
                  latitude:0
                 longitude:0
                   message:@"위치 권한 응답을 기다리고 있습니다."];
    return;
  }
  if (error.code == kCLErrorDenied) {
    [self finishWithStatus:1
                  latitude:0
                 longitude:0
                   message:error.localizedDescription ?: @"위치 권한이 거부되었습니다."];
    return;
  }
  [self finishWithStatus:2
                latitude:0
               longitude:0
                 message:error.localizedDescription ?: @"현재 위치를 가져오지 못했습니다."];
}

@end

void tiny_farm_request_location(TinyFarmLocationCallback callback, void *context) {
  dispatch_async(dispatch_get_main_queue(), ^{
    TinyFarmLocationRequest *request =
        [[TinyFarmLocationRequest alloc] initWithCallback:callback context:context];
    [request start];
  });
}

typedef void (*TinyFarmAuthorizationCallback)(int32_t authorized);

/**
 * Long-lived authorization observer.
 *
 * The user can allow location after a request already failed, either in the prompt or later in
 * System Settings. Without an observer the app would keep showing the failure until the next
 * scheduled retry, so this keeps one manager alive purely to report authorization changes.
 */
@interface TinyFarmAuthorizationWatcher : NSObject <CLLocationManagerDelegate>
@property(nonatomic, strong) CLLocationManager *manager;
@property(nonatomic, assign) TinyFarmAuthorizationCallback callback;
@property(nonatomic, assign) BOOL lastAuthorized;
@end

static TinyFarmAuthorizationWatcher *authorizationWatcher;

@implementation TinyFarmAuthorizationWatcher

- (BOOL)isAuthorizedStatus:(CLAuthorizationStatus)status {
  return status == kCLAuthorizationStatusAuthorized;
}

- (CLAuthorizationStatus)currentStatus {
  if (@available(macOS 11.0, *)) {
    return self.manager.authorizationStatus;
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return [CLLocationManager authorizationStatus];
#pragma clang diagnostic pop
}

- (void)notifyIfChanged {
  BOOL authorized =
      [self isAuthorizedStatus:[self currentStatus]] && [CLLocationManager locationServicesEnabled];
  if (authorized == self.lastAuthorized) {
    return;
  }
  self.lastAuthorized = authorized;
  if (self.callback != NULL) {
    self.callback(authorized ? 1 : 0);
  }
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
  [self notifyIfChanged];
}

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-implementations"
- (void)locationManager:(CLLocationManager *)manager
    didChangeAuthorizationStatus:(CLAuthorizationStatus)status {
  [self notifyIfChanged];
}
#pragma clang diagnostic pop

@end

/** Current CLAuthorizationStatus. 0 notDetermined, 1 restricted, 2 denied, 3 authorized. */
int32_t tiny_farm_location_authorization(void) {
  if (@available(macOS 11.0, *)) {
    if (authorizationWatcher != nil && authorizationWatcher.manager != nil) {
      return (int32_t)authorizationWatcher.manager.authorizationStatus;
    }
    CLLocationManager *manager = [[CLLocationManager alloc] init];
    return (int32_t)manager.authorizationStatus;
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return (int32_t)[CLLocationManager authorizationStatus];
#pragma clang diagnostic pop
}

/** Whether the system-wide Location Services switch is on. */
int32_t tiny_farm_location_services_enabled(void) {
  return [CLLocationManager locationServicesEnabled] ? 1 : 0;
}

/** 감시자를 만들어 둔다. 이미 있으면 그대로 쓴다. 메인 스레드에서만 호출한다. */
static void tinyFarmEnsureWatcher(void) {
  // NSAssert 는 메서드 전용 매크로라 C 함수에서는 NSCAssert 를 쓴다.
  NSCAssert([NSThread isMainThread], @"watcher must be created on the main thread");
  if (authorizationWatcher != nil) {
    return;
  }
  authorizationWatcher = [[TinyFarmAuthorizationWatcher alloc] init];
  authorizationWatcher.manager = [[CLLocationManager alloc] init];
  authorizationWatcher.manager.delegate = authorizationWatcher;
  authorizationWatcher.lastAuthorized =
      [authorizationWatcher isAuthorizedStatus:[authorizationWatcher currentStatus]] &&
      [CLLocationManager locationServicesEnabled];
}

static void tinyFarmRequestAuthorizationViaWatcher(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    tinyFarmEnsureWatcher();
    if (@available(macOS 10.15, *)) {
      [authorizationWatcher.manager requestWhenInUseAuthorization];
    }
  });
}

void tiny_farm_start_authorization_watch(TinyFarmAuthorizationCallback callback) {
  dispatch_async(dispatch_get_main_queue(), ^{
    tinyFarmEnsureWatcher();
    authorizationWatcher.callback = callback;
  });
}
