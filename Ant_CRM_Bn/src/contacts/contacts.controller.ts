import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto, ImportContactsDto, UpdateContactDto } from './dto';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.contactsService.list(req.user.sub, search, tag, Number(page) || 1, Number(pageSize) || 50);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.contactsService.findOne(id, req.user.sub);
  }

  @Post()
  create(@Body() dto: CreateContactDto, @Req() req: any) {
    return this.contactsService.create(dto, req.user.sub);
  }

  @Post('import')
  import(@Body() dto: ImportContactsDto, @Req() req: any) {
    return this.contactsService.importPhones(dto.phones, req.user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContactDto, @Req() req: any) {
    return this.contactsService.update(id, dto, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.contactsService.remove(id, req.user.sub);
  }
}
