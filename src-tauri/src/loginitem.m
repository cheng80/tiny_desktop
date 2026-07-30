#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>

#include <stdint.h>

/**
 * 로그인 시 실행 등록.
 *
 * 직접 만든 LaunchAgent 로도 실행은 되지만, 실행 프로그램이 `/usr/bin/open` 이라
 * macOS 백그라운드 항목 관리가 이 항목을 Apple 시스템 바이너리로 귀속시켜
 * 시스템 설정 > 일반 > 로그인 항목 목록에 앱이 나타나지 않았다.
 *
 * SMAppService 로 앱 자신을 등록하면 목록에 `Tiny Farm` 으로 표시되고, 사용자가 그
 * 화면에서 켜고 끌 수 있다. macOS 13 부터 쓸 수 있어 이전 버전은 호출부에서 LaunchAgent
 * 방식으로 되돌린다.
 */

/** 0 notRegistered, 1 enabled, 2 requiresApproval, 3 notFound, -1 지원 안 함 */
int32_t tiny_farm_login_item_status(void) {
  if (@available(macOS 13.0, *)) {
    return (int32_t)[SMAppService mainAppService].status;
  }
  return -1;
}

/** 성공 0, 실패 1, 지원 안 함 -1. 실패 메시지는 buffer 에 UTF-8 로 채운다. */
int32_t tiny_farm_login_item_register(char *buffer, int32_t capacity) {
  if (@available(macOS 13.0, *)) {
    NSError *error = nil;
    if ([[SMAppService mainAppService] registerAndReturnError:&error]) {
      return 0;
    }
    if (buffer != NULL && capacity > 0) {
      NSString *message = error.localizedDescription ?: @"등록에 실패했습니다.";
      strlcpy(buffer, message.UTF8String, (size_t)capacity);
    }
    return 1;
  }
  return -1;
}

int32_t tiny_farm_login_item_unregister(char *buffer, int32_t capacity) {
  if (@available(macOS 13.0, *)) {
    NSError *error = nil;
    if ([[SMAppService mainAppService] unregisterAndReturnError:&error]) {
      return 0;
    }
    if (buffer != NULL && capacity > 0) {
      NSString *message = error.localizedDescription ?: @"해제에 실패했습니다.";
      strlcpy(buffer, message.UTF8String, (size_t)capacity);
    }
    return 1;
  }
  return -1;
}
