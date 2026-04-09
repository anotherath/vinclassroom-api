import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateRoomDto, UpdateRoomDto, AddRoomMemberDto } from './dto';

// Custom request interface with user
interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags('Rooms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller()
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  /**
   * POST /spaces/:spaceId/rooms
   * Create a new room in a space
   */
  @Post('spaces/:spaceId/rooms')
  @HttpCode(HttpStatus.CREATED)
  async createRoom(
    @Param('spaceId') spaceId: string,
    @Body() dto: CreateRoomDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const room = await this.roomsService.createRoom(spaceId, req.user.id, dto);
    return {
      success: true,
      data: room,
    };
  }

  /**
   * GET /rooms/:roomId
   * Get room details
   */
  @Get('rooms/:roomId')
  @HttpCode(HttpStatus.OK)
  async getRoom(@Param('roomId') roomId: string): Promise<any> {
    const room = await this.roomsService.getRoomById(roomId);
    return {
      success: true,
      data: room,
    };
  }

  /**
   * PATCH /rooms/:roomId
   * Update room
   */
  @Patch('rooms/:roomId')
  @HttpCode(HttpStatus.OK)
  async updateRoom(
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const room = await this.roomsService.updateRoom(roomId, req.user.id, dto);
    return {
      success: true,
      data: room,
    };
  }

  /**
   * DELETE /rooms/:roomId
   * Delete room
   */
  @Delete('rooms/:roomId')
  @HttpCode(HttpStatus.OK)
  async deleteRoom(
    @Param('roomId') roomId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.roomsService.deleteRoom(roomId, req.user.id);
    return {
      success: true,
      message: 'Room deleted successfully',
    };
  }

  /**
   * GET /spaces/:spaceId/rooms
   * Get all rooms in a space
   */
  @Get('spaces/:spaceId/rooms')
  @HttpCode(HttpStatus.OK)
  async getSpaceRooms(
    @Param('spaceId') spaceId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const rooms = await this.roomsService.getSpaceRooms(spaceId, req.user.id);
    return {
      success: true,
      data: rooms,
    };
  }

  /**
   * GET /rooms/:roomId/members
   * Get room members
   */
  @Get('rooms/:roomId/members')
  @HttpCode(HttpStatus.OK)
  async getRoomMembers(@Param('roomId') roomId: string): Promise<any> {
    const members = await this.roomsService.getRoomMembers(roomId);
    return {
      success: true,
      data: members,
    };
  }

  /**
   * POST /rooms/:roomId/members
   * Add member to room
   */
  @Post('rooms/:roomId/members')
  @HttpCode(HttpStatus.CREATED)
  async addRoomMember(
    @Param('roomId') roomId: string,
    @Body() dto: AddRoomMemberDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    // Get room to find space_id
    const room = await this.roomsService.getRoomById(roomId);
    
    await this.roomsService.addRoomMember(roomId, room.space_id, dto);
    return {
      success: true,
      message: 'Member added successfully',
    };
  }

  /**
   * DELETE /rooms/:roomId/members/:userId
   * Remove member from room
   */
  @Delete('rooms/:roomId/members/:userId')
  @HttpCode(HttpStatus.OK)
  async removeRoomMember(
    @Param('roomId') roomId: string,
    @Param('userId') userId: string,
  ): Promise<any> {
    await this.roomsService.removeRoomMember(roomId, userId);
    return {
      success: true,
      message: 'Member removed successfully',
    };
  }

  /**
   * GET /rooms/:roomId/stats
   * Get room statistics
   */
  @Get('rooms/:roomId/stats')
  @HttpCode(HttpStatus.OK)
  async getRoomStats(@Param('roomId') roomId: string): Promise<any> {
    const stats = await this.roomsService.getRoomStats(roomId);
    return {
      success: true,
      data: stats,
    };
  }
}
